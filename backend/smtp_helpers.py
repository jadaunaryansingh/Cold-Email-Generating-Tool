import smtplib
from typing import List, Tuple


def build_smtp_attempts(smtp_server: str, port: int | None, use_tls: bool = True, use_ssl: bool = False) -> List[Tuple[bool, int, bool]]:
    provider = (smtp_server or "").lower()
    attempts: List[Tuple[bool, int, bool]] = []

    if use_ssl:
        attempts.append((True, int(port or 465), False))
    else:
        attempts.append((False, int(port or 587), use_tls))

    if "yahoo" in provider:
        attempts = [(True, 465, False), (False, 587, True)] + attempts
    elif "outlook" in provider or "hotmail" in provider or "live" in provider:
        attempts = [(False, 587, True)] + attempts
    elif "gmail" in provider:
        attempts = [(False, 587, True)] + attempts

    unique_attempts: List[Tuple[bool, int, bool]] = []
    seen = set()
    for attempt in attempts:
        if attempt not in seen:
            seen.add(attempt)
            unique_attempts.append(attempt)
    return unique_attempts


def is_retryable_smtp_error(exc: Exception) -> bool:
    if isinstance(exc, (smtplib.SMTPAuthenticationError,)):
        return False

    error_text = str(exc).lower()
    retry_tokens = [
        "connection unexpectedly closed",
        "server disconnected",
        "connection reset",
        "temporarily unavailable",
        "timed out",
        "timeout",
        "try again",
        "421",
        "4.7.0",
        "socket",
        "connection refused",
        "network is unreachable",
    ]
    return any(token in error_text for token in retry_tokens)
