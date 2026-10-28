"""Two memories agreeing promote an edge; one memory leaves it proposed."""

from swarm.weave import promote_edges


def test_two_memories_verify():
    edges = promote_edges(
        [
            {"source": "Ada", "target": "Lab", "kind": "located_at", "evidence": ["m1"]},
            {"source": "ada", "target": "lab", "kind": "located_at", "evidence": ["m2"]},
            {"source": "Ada", "target": "Lab", "kind": "knows", "evidence": "m1"},
        ]
    )
    by_kind = {edge["kind"]: edge for edge in edges}
    assert by_kind["located_at"]["status"] == "verified"
    assert by_kind["located_at"]["evidence"] == ["m1", "m2"]
    assert by_kind["knows"]["status"] == "proposed"


def test_same_memory_twice_stays_proposed():
    edges = promote_edges(
        [
            {"source": "Ada", "target": "Lab", "kind": "knows", "evidence": ["m1"]},
            {"source": "Ada", "target": "Lab", "kind": "knows", "evidence": ["m1"]},
        ]
    )
    assert edges[0]["status"] == "proposed"
    assert edges[0]["evidence"] == ["m1"]
