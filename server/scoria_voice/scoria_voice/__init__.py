"""scoria-voice: a full-duplex voice front end with a real brain behind it.

PersonaPlex (NVIDIA's Moshi fork) is the mouth and the ears: low-latency,
full-duplex, consistent persona. It is also a 7B model that does not know
your life, cannot browse, and cannot call tools. This package wires it to a
brain — the strongest local LLM the machine runs through Ollama — that
listens to the user transcript, uses Scoria memory and the web, and feeds
PersonaPlex two ways:

* **briefs**: facts written into the conversation as a `<system>` block, the
  same mechanism PersonaPlex uses for its role prompt, so it speaks them in
  its own words;
* **say**: text forced onto the model's text stream, token by token, with
  the model keeping its own pacing — exact wording when it matters.

The meta prompt (how it likes to speak) is state the user edits live; every
refinement is injected the same way.
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
