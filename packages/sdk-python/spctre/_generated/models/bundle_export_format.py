from enum import Enum


class BundleExportFormat(str, Enum):
    CEDAR = "cedar"
    MCP_PROXY_CONFIG = "mcp-proxy-config"
    OPA_BUNDLE = "opa-bundle"
    OPA_REGO = "opa-rego"
    SPCTRE_JSON = "spctre-json"

    def __str__(self) -> str:
        return str(self.value)
