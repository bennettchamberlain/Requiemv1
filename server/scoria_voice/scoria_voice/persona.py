"""The meta prompt: how the voice likes to speak, editable while it talks.

A persona is a base description plus an ordered list of refinements the user
(or the brain, on the user's spoken request) adds during a conversation. The
rendered `<system>` text is what PersonaPlex reads at session start, and each
change is re-injected live as a new system block.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_BASE = (
    "You enjoy having a good conversation. You are Scoria, a warm, quick, "
    "plain-spoken companion. Keep replies short, one or two sentences, and "
    "ask a short follow-up when it helps. You have a second mind that checks "
    "memory and the web for you; when facts arrive, use them naturally."
)


@dataclass
class Persona:
    base: str = DEFAULT_BASE
    refinements: list[str] = field(default_factory=list)
    voice: str = "NATF2.pt"
    updated_at: float = field(default_factory=time.time)

    def render(self) -> str:
        parts = [self.base.strip()]
        parts.extend(r.strip() for r in self.refinements if r.strip())
        return " ".join(parts)

    def refine(self, instruction: str) -> None:
        instruction = instruction.strip()
        if instruction and instruction not in self.refinements:
            self.refinements.append(instruction)
            self.updated_at = time.time()

    def replace(self, *, base: str | None = None, refinements: list[str] | None = None, voice: str | None = None) -> None:
        if base is not None:
            self.base = base
        if refinements is not None:
            self.refinements = list(refinements)
        if voice is not None:
            self.voice = voice
        self.updated_at = time.time()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["rendered"] = self.render()
        return d


class PersonaStore:
    def __init__(self, path: Path):
        self.path = path
        self.persona = self._load()

    def _load(self) -> Persona:
        if self.path.exists():
            try:
                d = json.loads(self.path.read_text())
                return Persona(base=d.get("base", DEFAULT_BASE), refinements=d.get("refinements", []), voice=d.get("voice", "NATF2.pt"))
            except Exception:  # noqa: BLE001
                pass
        return Persona()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(asdict(self.persona), indent=2))
