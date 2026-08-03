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


class TestUrlAndHeaderScrubbing:
    """Regressions for the confirmed leaks found in adversarial review."""

    def test_scrubs_request_url_query_string(self):
        event = scrub_event(
            {"request": {"url": "https://memory.local/api/graph/search?query=oncologist&people=Dr.%20Chen"}}
        )

        assert event["request"]["url"] == "https://memory.local/api/graph/search"

    def test_scrubs_referer_header(self):
        event = scrub_event(
            {"request": {"headers": {"Referer": "https://memory.local/memory?search=divorce%20lawyer"}}}
        )

        assert event["request"]["headers"]["Referer"] == "https://memory.local/memory"

    def test_matches_hyphenated_api_key_header(self):
        event = scrub_event({"request": {"headers": {"x-api-key": "ci_live_abcdef123456"}}})

        assert event["request"]["headers"]["x-api-key"] == "[Filtered]"

    def test_drops_server_name(self):
        assert "server_name" not in scrub_event({"server_name": "MacBook-Pro-2.local"})

    def test_collapses_windows_home_paths(self):
        assert scrub_string("C:\\Users\\liam\\AppData\\ci\\timeline.db") == "~\\AppData\\ci\\timeline.db"
        assert scrub_string("C:/Users/liam/AppData/ci") == "~/AppData/ci"


class TestLogentryScrubbing:
    def test_scrubs_formatted_and_params_not_just_format_string(self):
        event = scrub_event(
            {
                "logentry": {
                    "message": "auth to %s failed with token %s",
                    "formatted": "auth to https://portal.example failed with token tskey-abc123XYZ",
                    "params": ["https://portal.example", "tskey-abc123XYZ"],
                }
            }
        )

        assert "tskey-abc123XYZ" not in event["logentry"]["formatted"]
        assert "tskey-abc123XYZ" not in str(event["logentry"]["params"])


class TestBreadcrumbScrubbing:
    def test_scrubs_python_sdk_breadcrumb_shape(self):
        event = scrub_event(
            {
                "breadcrumbs": {
                    "values": [
                        {"message": "loaded /home/ci/journal.db", "data": {"token": "abc123456"}},
                    ]
                }
            }
        )
        crumb = event["breadcrumbs"]["values"][0]

        assert crumb["message"] == "loaded ~/journal.db"
        assert crumb["data"]["token"] == "[Filtered]"

    def test_scrubs_breadcrumb_urls(self):
        event = scrub_event(
            {"breadcrumbs": {"values": [{"data": {"url": "/api/search?query=private"}}]}}
        )

        assert event["breadcrumbs"]["values"][0]["data"]["url"] == "/api/search"

    def test_handles_bare_list_breadcrumb_shape(self):
        event = scrub_event({"breadcrumbs": [{"message": "at /Users/liam/x"}]})

        assert event["breadcrumbs"][0]["message"] == "at ~/x"


class TestStackFrameScrubbing:
    def test_scrubs_frame_paths_and_locals(self):
        event = scrub_event(
            {
                "exception": {
                    "values": [
                        {
                            "value": "boom",
                            "stacktrace": {
                                "frames": [
                                    {
                                        "filename": "/Users/liam/devel/ci/x.py",
                                        "abs_path": "/Users/liam/devel/ci/x.py",
                                        "vars": {"note_text": "/home/ci/journal", "password": "hunter2"},
                                    }
                                ]
                            },
                        }
                    ]
                }
            }
        )
        frame = event["exception"]["values"][0]["stacktrace"]["frames"][0]

        assert frame["filename"] == "~/devel/ci/x.py"
        assert frame["abs_path"] == "~/devel/ci/x.py"
        assert frame["vars"]["note_text"] == "~/journal"
        assert frame["vars"]["password"] == "[Filtered]"


class TestInitNeverRaises:
    def test_malformed_dsn_does_not_crash_startup(self, monkeypatch):
        import src.telemetry as telemetry_module

        monkeypatch.setattr(telemetry_module, "_initialized", False)
        monkeypatch.setenv("SENTRY_DSN", "not-a-dsn")

        # Must return False rather than raising BadDsn out of module import.
        assert telemetry_module.init_telemetry() is False


class TestHubIdentityHeader:
    def test_filters_ci_hub_user_header(self):
        event = scrub_event({"request": {"headers": {"x-ci-hub-user": "liam"}}})

        assert event["request"]["headers"]["x-ci-hub-user"] == "[Filtered]"

    def test_strips_query_from_location_header(self):
        event = scrub_event({"request": {"headers": {"location": "/memory?search=private"}}})

        assert event["request"]["headers"]["location"] == "/memory"


class TestContextLines:
    def test_scrubs_source_context_around_the_throw_site(self):
        event = scrub_event(
            {
                "exception": {
                    "values": [
                        {
                            "stacktrace": {
                                "frames": [
                                    {
                                        "pre_context": ['DIR = "/home/ci/notes"'],
                                        "context_line": 'client = Client(api_key="sk-live-9988776655")',
                                        "post_context": ['headers = {"authorization": "Bearer abcdefghij"}'],
                                    }
                                ]
                            }
                        }
                    ]
                }
            }
        )
        frame = event["exception"]["values"][0]["stacktrace"]["frames"][0]

        assert "sk-live-9988776655" not in frame["context_line"]
        assert frame["pre_context"][0] == 'DIR = "~/notes"'
        assert "abcdefghij" not in frame["post_context"][0]
