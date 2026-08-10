from enum import Enum


class ExportComplianceFramework(str, Enum):
    EU_AI_ACT = "eu-ai-act"
    GDPR = "gdpr"
    HIPAA = "hipaa"
    ISO27001 = "iso27001"
    NIST_AI_RMF = "nist-ai-rmf"
    PCI_DSS = "pci-dss"
    PUBLIC_SECTOR = "public-sector"
    SOC2 = "soc2"

    def __str__(self) -> str:
        return str(self.value)
