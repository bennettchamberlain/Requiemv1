"""Tests for the opt-in telemetry gate and the payload scrubber."""
from __future__ import annotations

import pytest

from src.telemetry import is_enabled, scrub_event, scrub_string

DSN = "https://publickey@o1.ingest.us.sentry.io/2"


class TestIsEnabled:
    def test_disabled_without_dsn(self):
        assert is_enabled({}) is False

    def test_enabled_with_dsn(self):
        assert is_enabled({"SENTRY_DSN": DSN}) is True

    def test_blank_dsn_counts_as_unset(self):
        assert is_enabled({"SENTRY_DSN": "   "}) is False

    @pytest.mark.parametrize("value", ["off", "OFF", "false", "0", "no", "disabled"])
    def test_opt_out_overrides_dsn(self, value):
        assert is_enabled({"SENTRY_DSN": DSN, "CI_TELEMETRY": value}) is False

    @pytest.mark.parametrize("value", ["on", "true", "1", "enabled", ""])
    def test_other_values_leave_dsn_in_charge(self, value):
        assert is_enabled({"SENTRY_DSN": DSN, "CI_TELEMETRY": value}) is True

    @pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", "on"])
    def test_local_only_forbids_reporting(self, value):
        assert is_enabled({"SENTRY_DSN": DSN, "CI_LOCAL_ONLY": value}) is False


class TestScrubString:
    def test_redacts_bearer_token(self):
        assert "eyJhbGciOi" not in scrub_string("Bearer eyJhbGciOiJIUzI1NiJ9.a.b")

    def test_redacts_labelled_secrets(self):
        assert "sk-live-123456" not in scrub_string("api_key=sk-live-123456")
        assert "hunter2" not in scrub_string("password: hunter2")

    def test_redacts_tailscale_key(self):
        assert scrub_string("tskey-auth-abc123-def") == "[Filtered]"

    def test_redacts_connection_url_credentials(self):
        scrubbed = scrub_string("postgresql://ci:s3cret@db:5432/companion")
        assert "s3cret" not in scrubbed

    def test_collapses_home_paths(self):
        assert scrub_string("/home/ci/data/timeline.db") == "~/data/timeline.db"
        assert scrub_string("/Users/liam/notes.md") == "~/notes.md"

    def test_truncates_oversized_strings(self):
        scrubbed = scrub_string("a" * 9000)
        assert scrubbed.endswith("… [truncated]")
        assert len(scrubbed) == 8000 + len("… [truncated]")

    def test_leaves_ordinary_text_alone(self):
        assert scrub_string("KeyError: 'user_id'") == "KeyError: 'user_id'"


class TestScrubEvent:
    def test_scrubs_message_and_exception_values(self):
        event = scrub_event(
            {
                "message": "failed at /home/ci/x",
                "exception": {"values": [{"value": "Bearer abcdefghijkl rejected"}]},
            }
        )

        assert event["message"] == "failed at ~/x"
        assert "abcdefghijkl" not in event["exception"]["values"][0]["value"]

    def test_scrubs_logentry_message(self):
        event = scrub_event({"logentry": {"message": "token=abc123456"}})

        assert "abc123456" not in event["logentry"]["message"]

    def test_filters_sensitive_extra_keys_at_depth(self):
        event = scrub_event({"extra": {"outer": {"password": "hunter2", "path": "/home/ci/y"}}})

        assert event["extra"]["outer"]["password"] == "[Filtered]"
        assert event["extra"]["outer"]["path"] == "~/y"

    def test_drops_request_cookies_body_and_query(self):
        event = scrub_event(
            {
                "request": {
                    "cookies": {"sessionToken": "abc"},
                    "data": {"q": "private"},
                    "query_string": "q=private",
                    "headers": {"authorization": "Bearer abc", "user-agent": "curl/8"},
                }
            }
        )

        assert "cookies" not in event["request"]
        assert "data" not in event["request"]
        assert event["request"]["query_string"] == "[Filtered]"
        assert event["request"]["headers"]["authorization"] == "[Filtered]"
        assert event["request"]["headers"]["user-agent"] == "curl/8"

    def test_survives_cyclic_extra(self):
        cyclic = {"name": "loop"}
        cyclic["self"] = cyclic

        scrub_event({"extra": cyclic})  # must not raise or hang

    def test_passes_through_clean_event(self):
        assert scrub_event({"message": "plain failure"}) == {"message": "plain failure"}
