package worker

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

// The gateway decision path is implemented twice: in TypeScript
// (packages/policy-schema) and here, because the worker serves delegated
// decide traffic. Only the matching logic is written twice — the vocabulary
// is generated from the TypeScript source of truth by
// scripts/generate-worker-policy-data.mjs and embedded below, so a keyword
// added on one side cannot silently go missing on the other. CI byte-compares
// the generated file; the shared conformance fixtures cover the logic.
//
//go:embed semantic_topics.json
var semanticTopicsJSON []byte

type semanticTopic struct {
	ID             string   `json:"id"`
	PromptTriggers []string `json:"promptTriggers"`
	Keywords       []string `json:"keywords"`
}

type semanticTopicTables struct {
	// Order is significant: topics are evaluated in sequence, first match wins.
	Topics       []semanticTopic `json:"topics"`
	StopWords    []string        `json:"stopWords"`
	GenericWords []string        `json:"genericWords"`
	MatchRatio   float64         `json:"matchRatio"`

	stopWords    map[string]struct{}
	genericWords map[string]struct{}
}

var semanticTables = mustLoadSemanticTopics()

func mustLoadSemanticTopics() *semanticTopicTables {
	var tables semanticTopicTables
	if err := json.Unmarshal(semanticTopicsJSON, &tables); err != nil {
		panic(fmt.Sprintf("worker: semantic_topics.json is unreadable: %v", err))
	}
	if len(tables.Topics) == 0 || tables.MatchRatio <= 0 {
		panic("worker: semantic_topics.json is empty; regenerate with pnpm generate:worker-policy-data")
	}
	tables.stopWords = toSet(tables.StopWords)
	tables.genericWords = toSet(tables.GenericWords)
	return &tables
}

func toSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return set
}

// classifySemanticIntent mirrors the TypeScript function of the same name.
//
// It is deliberately a deterministic heuristic, not an LLM classifier: exact
// quoted matches first, then narrow safety-topic keyword sets, then a
// token-overlap fallback. Any change here must be mirrored in TypeScript and
// covered by a conformance fixture.
func classifySemanticIntent(prompt, toolIntent, planSummary string, toolParameters map[string]any) bool {
	cleanPrompt := strings.ToLower(strings.TrimSpace(prompt))
	searchSpace := strings.ToLower(strings.Join([]string{
		toolIntent,
		planSummary,
		marshalSearchSpace(toolParameters),
	}, " "))

	// 1. Quoted patterns (exact matching). If the prompt quotes anything, only
	// those quotes decide the outcome.
	if quoted := extractQuoted(cleanPrompt); len(quoted) > 0 {
		for _, exact := range quoted {
			if exact != "" && strings.Contains(searchSpace, exact) {
				return true
			}
		}
		return false
	}

	// 2. Predefined safety-topic classification, in declaration order.
	for _, topic := range semanticTables.Topics {
		if !containsAny(cleanPrompt, topic.PromptTriggers) {
			continue
		}
		if containsAny(searchSpace, topic.Keywords) {
			return true
		}
	}

	// 3. Fallback: word token set inclusion.
	words := promptWords(cleanPrompt)
	if len(words) == 0 {
		return false
	}
	matched := make([]string, 0, len(words))
	for _, word := range words {
		if strings.Contains(searchSpace, word) {
			matched = append(matched, word)
		}
	}
	if float64(len(matched))/float64(len(words)) < semanticTables.MatchRatio {
		return false
	}
	// Generic words alone do not carry intent: if nothing non-generic matched
	// while the prompt did contain non-generic words, this is not a match.
	nonGenericPrompt := 0
	for _, word := range words {
		if _, generic := semanticTables.genericWords[word]; !generic {
			nonGenericPrompt++
		}
	}
	matchedNonGeneric := 0
	for _, word := range matched {
		if _, generic := semanticTables.genericWords[word]; !generic {
			matchedNonGeneric++
		}
	}
	if nonGenericPrompt > 0 && matchedNonGeneric == 0 {
		return false
	}
	return true
}

// marshalSearchSpace renders tool parameters the way JSON.stringify does for
// the TypeScript search space.
//
// Go sorts map keys where JavaScript preserves insertion order, so the two
// strings can differ in key order. Matching is case-folded substring search, so
// ordering only matters for a keyword that spans a key boundary — the
// conformance fixtures cover parameter-bearing cases to keep that honest.
func marshalSearchSpace(toolParameters map[string]any) string {
	if toolParameters == nil {
		return "{}"
	}
	encoded, err := json.Marshal(toolParameters)
	if err != nil {
		// Unserializable parameters must not read as "nothing suspicious here".
		// Fall back to Go's own rendering so the text is still searched.
		return fmt.Sprintf("%v", toolParameters)
	}
	return string(encoded)
}

// extractQuoted returns the contents of every "..." pair, trimmed.
func extractQuoted(prompt string) []string {
	var quoted []string
	rest := prompt
	for {
		open := strings.Index(rest, `"`)
		if open < 0 {
			return quoted
		}
		rest = rest[open+1:]
		closeAt := strings.Index(rest, `"`)
		if closeAt < 0 {
			return quoted
		}
		quoted = append(quoted, strings.TrimSpace(rest[:closeAt]))
		rest = rest[closeAt+1:]
	}
}

// promptWords splits on non-alphanumerics and drops stop words and single
// characters, mirroring the TypeScript tokenizer.
func promptWords(prompt string) []string {
	fields := strings.FieldsFunc(prompt, func(r rune) bool {
		isAlphaNum := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
		return !isAlphaNum
	})
	words := make([]string, 0, len(fields))
	for _, field := range fields {
		word := strings.TrimSpace(field)
		if len(word) <= 1 {
			continue
		}
		if _, stop := semanticTables.stopWords[word]; stop {
			continue
		}
		words = append(words, word)
	}
	return words
}

func containsAny(haystack string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}

// evaluateSemanticChecks returns the first check whose prompt classifies as
// matching, along with any effect override it carries.
func evaluateSemanticChecks(
	checks []SemanticCheck,
	toolIntent, planSummary string,
	toolParameters map[string]any,
) (matched bool, prompt string, effectOverride *RuntimeDecisionStatus) {
	for _, check := range checks {
		if classifySemanticIntent(check.Prompt, toolIntent, planSummary, toolParameters) {
			return true, check.Prompt, check.Effect
		}
	}
	return false, "", nil
}
