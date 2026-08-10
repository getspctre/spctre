from enum import Enum


class TriggerKind(str, Enum):
    GATEWAY_MESSAGE = "gateway_message"
    INBOUND_WEBHOOK = "inbound_webhook"
    INTERACTIVE = "interactive"
    MOBILE_DISPATCH = "mobile_dispatch"
    ROUTINE = "routine"
    SCHEDULED = "scheduled"

    def __str__(self) -> str:
        return str(self.value)
