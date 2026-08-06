from __future__ import annotations

import logging
import re
from enum import Enum

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


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

_ACTION_CS = {
    "buy": "nákup (systém vidí spíš příležitost nahoru)",
    "sell": "prodej (systém vidí spíš slabost / dolů)",
    "hold": "držet / nic nedělat (signál je slabý nebo smíšený)",
    "trade": "obchodovat opatrně (mírný tip, ne silný trend)",
}

_HORIZON_CS = {
    "intraday": "během dne",
    "swing": "dny až týdny",
    "position": "týdny až měsíce",
    "long_term": "měsíce a déle",
}


def _score_plain(score: float) -> str:
    if score >= 35:
        return "spíš nákupní nálada"
    if score <= -35:
        return "spíš prodejní nálada"
    if abs(score) >= 15:
        return "slabší / smíšený signál"
    return "téměř neutrální — není důvod honit obchod"


def _conf_plain(conf: float) -> str:
    pct = int(round(conf * 100))
    if pct >= 70:
        return f"vyšší jistota modelu (~{pct} %)"
    if pct >= 50:
        return f"střední jistota (~{pct} %)"
    return f"nízká jistota (~{pct} %) — ber s rezervou"


def llm_status_note() -> str:
    """Human-readable why AI narrative may be missing."""
    s = get_settings()
    parts: list[str] = []
    has_cloud = bool(s.gemini_api_key or s.anthropic_api_key or s.openai_api_key)
    if not has_cloud:
        parts.append("v .env chybí cloudový API klíč (Gemini / Anthropic / OpenAI)")
    else:
        parts.append(
            f"cloud provider „{s.cloud_llm_provider or 'auto'}“ neodpověděl "
            "(kvóta, neplatný klíč, síť nebo model)"
        )
    parts.append(
        f"lokální Ollama na {s.ollama_base_url} neodpověděla "
        f"(kontejner vypnutý, nebo model „{s.ollama_model}“ není stažený)"
    )
    return " · ".join(parts)


def _parse_tip_line(line: str) -> dict | None:
    """Parse '- **MSFT**: hold | score 10.2 | conf 0.4 | swing'."""
    m = re.search(
        r"\*{0,2}([A-Z0-9.\-^=]+)\*{0,2}\s*:\s*"
        r"(\w+)\s*\|\s*score\s*([-\d.]+)\s*\|\s*conf\s*([-\d.]+)\s*\|\s*(\w+)",
        line,
        re.I,
    )
    if not m:
        return None
    try:
        return {
            "symbol": m.group(1).upper(),
            "action": m.group(2).lower(),
            "score": float(m.group(3)),
            "confidence": float(m.group(4)),
            "horizon": m.group(5).lower(),
        }
    except ValueError:
        return None


def _fallback_from_daily_context(context: str) -> str | None:
    if "TOP TIPY" not in context.upper() and "MAKRO" not in context.upper():
        return None

    sections: dict[str, list[str]] = {"makro": [], "tipy": [], "fokus": [], "portfolio": []}
    bucket = None
    for raw in context.splitlines():
        line = raw.strip()
        if not line:
            continue
        key = line.upper().rstrip(":")
        if key.startswith("MAKRO"):
            bucket = "makro"
            continue
        if key.startswith("TOP TIP"):
            bucket = "tipy"
            continue
        if key.startswith("FOKUS"):
            bucket = "fokus"
            continue
        if key.startswith("PORTFOLIO"):
            bucket = "portfolio"
            continue
        if bucket and line.startswith("-"):
            sections[bucket].append(line.lstrip("- ").strip())

    tips = []
    for line in sections["tipy"]:
        parsed = _parse_tip_line(line)
        if parsed:
            tips.append(parsed)

    out: list[str] = [
        "## Shrnutí (bez AI — jen výpočty)",
        "",
        "Sense teď **neumí převyprávět** data lidskou řečí, protože neběží ani cloudové AI, ani lokální Ollama. "
        "Níže je totéž čísly, ale vysvětlené jednoduše.",
        "",
        "### Co znamenají čísla",
        "- **Score (−100…+100):** jak silně model „tlačí“ na nákup (+) nebo prodej (−). Kolem nuly = spíš nic nedělat.",
        "- **Confidence (0…1):** jak si je model jistý. 0,4 = spíš tip s rezervou, ne jistota.",
        "- **Akce hold:** držet / nevyvolávat nový obchod.",
        "- **Horizont swing / long_term:** na jak dlouho tip míří (dny–týdny vs. měsíce).",
        "",
    ]

    makro = sections["makro"]
    out.append("### Makro")
    if not makro or any("bez dat" in x.lower() for x in makro):
        out.append(
            "Makro data (sazby, VIX, nezaměstnanost…) teď **nejsou v databázi**. "
            "Buď ještě neproběhl sync z FRED, nebo chybí / nefunguje `FRED_API_KEY`. "
            "Bez makra je celkový pohled chudší — tipy stojí hlavně na grafu a fundamentu tickeru."
        )
    else:
        out.append("Aktuální makro body, které Sense má:")
        for m in makro[:6]:
            out.append(f"- {m}")
    out.append("")

    out.append("### Nejsilnější tipy dnes")
    if not tips:
        out.append("Žádné aktivní tipy.")
    else:
        out.append(
            "Seřazeno od „nejvýraznějšího“ score. **Hold + nízké score** = trh je podle modelu "
            "víceméně v klidu — není to signál k nákupu."
        )
        out.append("")
        for t in tips[:8]:
            act = _ACTION_CS.get(t["action"], t["action"])
            hor = _HORIZON_CS.get(t["horizon"], t["horizon"])
            out.append(
                f"- **{t['symbol']}** — {act}. "
                f"Score **{t['score']:.1f}** ({_score_plain(t['score'])}). "
                f"{_conf_plain(t['confidence']).capitalize()}. "
                f"Horizont: {hor}."
            )
    out.append("")

    if sections["portfolio"]:
        out.append("### Portfolio")
        if any("prázdné" in x.lower() for x in sections["portfolio"]):
            out.append("V portfoliu teď nic není (nebo jen paper mimo výpis).")
        else:
            out.append("Držené pozice:")
            for p in sections["portfolio"][:8]:
                out.append(f"- {p}")
        out.append("")

    out.extend(
        [
            "### Pre-závěr",
            "Dnes převažují **hold** tipy se skóre kolem nuly až +10 — Sense nevidí silný důvod "
            "honit nové vstupy. Sleduj spíš watchlist a makro, až budou data.",
            "",
            "### Rizika",
            "- Bez AI narativu chybí „příběh“; zůstávají jen skóre z pravidel.",
            "- Nízká confidence = snadno se tip otočí při novém scoringu.",
            "- Finální rozhodnutí je vždy na tobě.",
            "",
            f"_Proč bez AI: {llm_status_note()}_",
        ]
    )
    return "\n".join(out)


def _fallback_narrative(context: str) -> str:
    daily = _fallback_from_daily_context(context)
    if daily:
        return daily

    tips = []
    for line in (context or "").splitlines():
        parsed = _parse_tip_line(line)
        if parsed:
            tips.append(parsed)

    body = [
        "## Shrnutí (bez AI)",
        "",
        "Cloudové i lokální AI teď neodpovědělo, takže dostáváš **překlad výpočtů** místo vyprávění.",
        "",
    ]
    if tips:
        body.append("### Co z toho plyne")
        for t in tips[:6]:
            body.append(
                f"- **{t['symbol']}**: {_ACTION_CS.get(t['action'], t['action'])}; "
                f"score {t['score']:.1f} ({_score_plain(t['score'])}); "
                f"{_conf_plain(t['confidence'])}; "
                f"horizont {_HORIZON_CS.get(t['horizon'], t['horizon'])}."
            )
        body.append("")
    elif context.strip():
        body.append("### Surová data")
        body.append("```")
        body.append(context.strip()[:1800])
        body.append("```")
        body.append("")

    body.extend(
        [
            "### Rizika",
            "Bez AI textu chybí nuance — ověř graf, stop/cíl a kvalitu dat u konkrétního tickeru.",
            "",
            f"_Proč: {llm_status_note()}_",
        ]
    )
    return "\n".join(body)


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
                logger.warning(
                    "Ollama HTTP %s: %s",
                    resp.status_code,
                    (resp.text or "")[:200],
                )
                return ""
            return resp.json().get("message", {}).get("content", "") or ""
        except Exception as exc:
            logger.warning("Ollama nedostupné (%s): %s", settings.ollama_base_url, exc)
            return ""


async def _anthropic_chat(messages: list[dict]) -> str:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return ""
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
            logger.warning("Anthropic HTTP %s: %s", resp.status_code, (resp.text or "")[:200])
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
            logger.warning("OpenAI HTTP %s: %s", resp.status_code, (resp.text or "")[:200])
            return ""
        return resp.json()["choices"][0]["message"]["content"]


async def _gemini_chat(messages: list[dict]) -> str:
    settings = get_settings()
    if not settings.gemini_api_key:
        return ""
    prompt = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
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
                logger.warning(
                    "Gemini %s HTTP %s: %s", model, resp.status_code, (resp.text or "")[:180]
                )
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
        if not text:
            logger.warning("LLM fallback (light): %s", llm_status_note())
        return text or _fallback_narrative(context or user_prompt)

    text = await _cloud_chat(messages)
    if text:
        return text
    text = await _ollama_chat(messages)
    if not text:
        logger.warning("LLM fallback (heavy): %s", llm_status_note())
    return text or _fallback_narrative(context or user_prompt)


def _sanitize_chat_title(raw: str, symbol: str | None = None) -> str:
    line = (raw or "").strip().splitlines()[0] if raw else ""
    line = line.strip(" \"'`„“«»").rstrip(".!?:;")
    for prefix in ("název:", "title:", "nazev:"):
        if line.lower().startswith(prefix):
            line = line[len(prefix) :].strip()
    words = [w for w in line.replace("/", " ").split() if w]
    if len(words) > 3:
        words = words[:3]
    title = " ".join(words).strip()
    if not title:
        return "Nový chat"
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
