from __future__ import annotations

from enum import Enum

import httpx

from app.core.config import get_settings


class LLMTask(str, Enum):
    light = "light"  # local Ollama
    heavy = "heavy"  # cloud reasoning


SYSTEM_CS = (
    "Jsi StockSense — analytický rádce pro investování a trading. "
    "Odpovídej česky, věcně a strukturovaně. "
    "Nikdy nevymýšlej čísla: používej jen data dodaná v kontextu. "
    "Vždy uveď nejistotu, rizika a že finální rozhodnutí dělá uživatel."
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
    # Flatten to single prompt
    prompt = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={settings.gemini_api_key}"
    )
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json={"contents": [{"parts": [{"text": prompt}]}]})
        if resp.status_code != 200:
            return ""
        candidates = resp.json().get("candidates", [])
        if not candidates:
            return ""
        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts)


async def _cloud_chat(messages: list[dict]) -> str:
    settings = get_settings()
    provider = settings.cloud_llm_provider
    if provider == "anthropic":
        text = await _anthropic_chat(messages)
        if text:
            return text
    if provider == "openai":
        text = await _openai_chat(messages)
        if text:
            return text
    if provider == "gemini":
        text = await _gemini_chat(messages)
        if text:
            return text
    # fallback order
    for fn in (_anthropic_chat, _openai_chat, _gemini_chat):
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
