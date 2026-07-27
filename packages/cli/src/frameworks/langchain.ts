import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

/**
 * Generates .spctre/sitecustomize.py that patches langchain_core.tools.BaseTool.invoke
 * and BaseTool.ainvoke to emit Spctre evidence on every tool call.
 *
 * Covers both LangChain (sync) and LangGraph (async) agents with zero code changes.
 * If langgraph is installed, runtimeTarget.stack is set to LANGGRAPH automatically.
 *
 * Users run their agent with:
 *   .spctre/spctre-python python my_agent.py
 */
export function writeLangChainAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  return writePythonAdapterFromTemplate(config, {
    framework: "langchain",
    templateName: "langchain.py",
  });
}
