"""Optional CrewAI hierarchical weaver. Default path is swarm/weave.py."""

from __future__ import annotations

import os
from typing import Any

from crewai import LLM, Agent, Crew, Process, Task


def run_crew(snapshot: dict[str, Any]) -> dict[str, Any]:
    llm = LLM(
        model=os.environ.get("PARASAIL_MODEL", "parasail-glm-53-flash"),
        provider="openai",
        base_url=os.environ.get("PARASAIL_BASE_URL", "https://api.parasail.io/v1"),
        api_key=os.environ["PARASAIL_API_KEY"],
    )
    rules = (
        "Never invent a name that is not in the memories. "
        "Each of you sees only the slice in your task. "
        "Proposed edges are guesses until a second memory agrees."
    )
    dispatcher = Agent(
        role="Dispatcher",
        goal="Assign weave work without reading every memory",
        backstory=rules,
        llm=llm,
        allow_delegation=True,
    )
    identity = Agent(
        role="Identity resolver",
        goal="Merge the same person across Gmail, Calendar, and GitHub",
        backstory=rules,
        llm=llm,
    )
    linker = Agent(
        role="Cross-linker",
        goal="Propose edges between things that appear in two sources",
        backstory=rules,
        llm=llm,
    )
    memories = snapshot.get("memories") or []
    crew = Crew(
        agents=[dispatcher, identity, linker],
        tasks=[
            Task(
                agent=identity,
                description=(
                    "From these memories, list distinct people and the sources "
                    f"they appear in. Memories: {memories[:12]!r}"
                ),
                expected_output="JSON list of people with sources.",
            ),
            Task(
                agent=linker,
                description="Propose knows/supports/related edges across sources.",
                expected_output='JSON {"edges":[...]} using names from the memories.',
            ),
        ],
        process=Process.hierarchical,
        manager_agent=dispatcher,
        verbose=False,
    )
    out = crew.kickoff()
    return {"raw": str(out)[:2000]}
