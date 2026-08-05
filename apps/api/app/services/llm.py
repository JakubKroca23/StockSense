from __future__ import annotations

from enum import Enum

import httpx

from app.core.config import get_settings


class LLMTask(str, Enum):
    light = "light"  # local Ollama
    heavy = "heavy"  # cloud reasoning


SYSTEM_CS = (
    "Jsi StockSense — analytický rádce pro investování a trading. "
    "Odpovídej česky, věcně a přehledně. "
    "Nikdy nevymýšlej čísla: používej jen data dodaná v kontextu. "
    "Formátuj odpověď v markdownu s jasnými sekcemi:\n"
    "## Shrnutí\n"
    "## Analýza\n"
    "## Pre-závěr\n"
    "## Rizika\n"
    "Používej krátké odstavce, odrážky a **tučné** klíčové údaje. "
    "Na konci vždy uveď, že finální rozhodnutí dělá uživatel."
)


async def _ollama_chat(messages: list[dict], model: str | None = None) -> str:
    settings = get_settings()
    payload = {
        "model": model or settings.ollama_model,
        "messages": messages,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=payload)
            if resp.status_code != 200:
                return ""
            return resp.json().get("message", {}).get("content", "") or ""
        except Exception:
            return ""


async def _anthropic_chat(messages: list[dict]) -> str:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return ""
    # Convert to Anthropic format
    system = SYSTEM_CS
    anth_messages = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            anth_messages.append({"role": m["role"], "content": m["content"]})
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1200,
                "system": system,
                "messages": anth_messages,
            },
        )
        if resp.status_code != 200:
            return ""
        content = resp.json().get("content", [])
        return "".join(part.get("text", "") for part in content if part.get("type") == "text")


async def _openai_chat(messages: list[dict]) -> str:
    settings = get_settings()
    if not settings.openai_api_key:
        return ""
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={"model": "gpt-4o-mini", "messages": messages, "temperature": 0.3},
        )
        if resp.status_code != 200:
            return ""
        return resp.json()["choices"][0]["message"]["content"]


async def _gemini_chat(messages: list[dict]) -> str:
    settings = get_settings()
    if not settings.gemini_api_key:
        return ""
    prompt = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
    # Prefer models that currently have quota; fall through on 404/429.
    models = (
        "gemini-flash-latest",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash-latest",
    )
    async with httpx.AsyncClient(timeout=120.0) as client:
        for model in models:
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={settings.gemini_api_key}"
            )
            resp = await client.post(url, json={"contents": [{"parts": [{"text": prompt}]}]})
            if resp.status_code != 200:
                continue
            candidates = resp.json().get("candidates", [])
            if not candidates:
                continue
            parts = candidates[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts)
            if text:
                return text
    return ""


async def _cloud_chat(messages: list[dict]) -> str:
    settings = get_settings()
    provider = (settings.cloud_llm_provider or "none").lower()

    # Skip providers without keys instead of silently returning empty.
    order: list = []
    if provider == "anthropic" and settings.anthropic_api_key:
        order.append(_anthropic_chat)
    elif provider == "openai" and settings.openai_api_key:
        order.append(_openai_chat)
    elif provider == "gemini" and settings.gemini_api_key:
        order.append(_gemini_chat)

    for fn, key in (
        (_gemini_chat, settings.gemini_api_key),
        (_anthropic_chat, settings.anthropic_api_key),
        (_openai_chat, settings.openai_api_key),
    ):
        if key and fn not in order:
            order.append(fn)

    for fn in order:
        text = await fn(messages)
        if text:
            return text
    return ""


def _fallback_narrative(context: str) -> str:
    return (
        "Cloud/lokální LLM není dostupné. Níže je strukturovaný souhrn z výpočtů (bez AI narativu):\n\n"
        f"{context}\n\n"
        "Finální rozhodnutí je na tobě; ověř data quality a invalidaci tipu."
    )


async def llm_complete(user_prompt: str, *, task: LLMTask = LLMTask.light, context: str = "") -> str:
    messages = [
        {"role": "system", "content": SYSTEM_CS},
        {
            "role": "user",
            "content": f"Kontext (data):\n{context}\n\nÚkol:\n{user_prompt}" if context else user_prompt,
        },
    ]
    if task == LLMTask.light:
        text = await _ollama_chat(messages)
        if text:
            return text
        text = await _cloud_chat(messages)
        return text or _fallback_narrative(context or user_prompt)

    text = await _cloud_chat(messages)
    if text:
        return text
    text = await _ollama_chat(messages)
    return text or _fallback_narrative(context or user_prompt)


def _sanitize_chat_title(raw: str, symbol: str | None = None) -> str:
    line = (raw or "").strip().splitlines()[0] if raw else ""
    line = line.strip(" \"'`„“«»").rstrip(".!?:;")
    # drop markdown / labels
    for prefix in ("název:", "title:", "nazev:"):
        if line.lower().startswith(prefix):
            line = line[len(prefix) :].strip()
    words = [w for w in line.replace("/", " ").split() if w]
    if len(words) > 3:
        words = words[:3]
    title = " ".join(words).strip()
    if not title:
        return "Nový chat"
    if symbol and symbol.upper() not in title.upper() and len(words) < 3:
        # keep short; don't force symbol into every title
        pass
    return title[:64]


async def generate_chat_title(message: str, symbol: str | None = None) -> str:
    """Max 3-word Czech title for a chat session from the first user message."""
    hint = f" Symbol v kontextu: {symbol}." if symbol else ""
    messages = [
        {
            "role": "system",
            "content": (
                "Jsi pojmenovavač chatů pro investiční appku. "
                "Odpověz výhradně názvem o 1 až 3 slovech v češtině. "
                "Bez uvozovek, bez tečky, bez vysvětlení."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Vymysli stručný název chatu (max 3 slova) podle této otázky.{hint}\n"
                f"Otázka: {message[:600]}"
            ),
        },
    ]
    text = await _ollama_chat(messages)
    if not text:
        text = await _cloud_chat(messages)
    title = _sanitize_chat_title(text, symbol)
    if title == "Nový chat" or not title:
        # deterministic short fallback from message words
        words = [w for w in message.replace("\n", " ").split() if w.strip(".,;:!?")][:3]
        if symbol and words:
            return _sanitize_chat_title(f"{symbol} {' '.join(words[:2])}", symbol)
        return _sanitize_chat_title(" ".join(words) or (symbol or "Nový chat"), symbol)
    return title


async def narrate_tip(symbol: str, tip_payload: dict) -> str:
    ctx = (
        f"Symbol: {symbol}\n"
        f"Akce: {tip_payload.get('action')}\n"
        f"Horizont: {tip_payload.get('horizon')}\n"
        f"Score: {tip_payload.get('score')}\n"
        f"Confidence: {tip_payload.get('confidence')}\n"
        f"Entry: {tip_payload.get('entry_low')}–{tip_payload.get('entry_high')}\n"
        f"Stop: {tip_payload.get('stop')}\n"
        f"Cíle: {tip_payload.get('target_1')}, {tip_payload.get('target_2')}\n"
        f"Zdůvodnění: {tip_payload.get('rationale')}\n"
        f"Data quality: {tip_payload.get('data_quality')}\n"
    )
    return await llm_complete(
        "Napiš stručný český narativ tipu (max 8 vět): pre-závěr, proč, rizika, co sledovat dál.",
        task=LLMTask.heavy,
        context=ctx,
    )
