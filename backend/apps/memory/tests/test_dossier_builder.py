from datetime import datetime
from uuid import UUID
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.dossier_builder import UserDossierBuilder  # noqa: E402


def test_builder_wraps_llm_payload(monkeypatch):
    user_id = UUID('00000000-0000-0000-0000-000000000001')
    builder = UserDossierBuilder(lookback_days=3, max_chars=120)

    def fake_get_daily_summaries(_user_id, start, end):
        assert _user_id == user_id
        assert end > start
        return [
            {
                'summary_text': 'Handled project planning and errands.',
                'period_start': start,
                'activity_counts': {'events': 2},
                'structured_context': {'key_insights': ['Prefers blunt updates']},
            }
        ]

    def fake_generate_user_dossier(**kwargs):
        assert kwargs['user_id'] == str(user_id)
        return {
            'summary': 'User wants honest, concise updates.',
            'tone': 'direct',
            'interactionGuidelines': ['Be concise.'],
        }

    monkeypatch.setattr('src.dossier_builder.storage.get_daily_summaries', fake_get_daily_summaries)
    monkeypatch.setattr('src.dossier_builder.summarizer.generate_user_dossier', fake_generate_user_dossier)

    result = builder.build(user_id, datetime(2025, 1, 2), 'UTC')

    assert result is not None
    assert result['summary'] == 'User wants honest, concise updates.'
    assert result['tone'] == 'direct'
    assert result['sourceWindow']['timezone'] == 'UTC'
    assert 'lastUpdatedAt' in result
