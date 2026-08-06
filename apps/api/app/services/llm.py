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
    "long": "long (systém vidí spíš příležitost nahoru)",
    "short": "short (systém vidí silnou slabost / dolů)",
    "hold": "držet / nic nedělat (signál je slabý nebo smíšený)",
    "sell": "prodat (mírný medvědí tip / redukce)",
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
    if not s.gemini_api_key:
        return "v .env chybí GEMINI_API_KEY"
    return (
        f"Gemini („{s.cloud_llm_provider or 'gemini'}“) neodpověděl "
        "(kvóta, neplatný klíč, síť nebo model)"
    )


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
    """Deprecated — Ollama disabled; StockSense uses Gemini only."""
    return ""


async def _anthropic_chat(messages: list[dict]) -> str:
    return ""


async def _openai_chat(messages: list[dict]) -> str:
    return ""


async def _gemini_chat(messages: list[dict]) -> str:
    settings = get_settings()
    if not settings.gemini_api_key:
        logger.warning("Gemini: chybí GEMINI_API_KEY")
        return ""
    # Prefer 2.5 — free-tier quota on 2.0 / flash-latest is often exhausted (429).
    models = (
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-flash-latest",
    )
    system_bits: list[str] = []
    user_bits: list[str] = []
    for m in messages:
        role = (m.get("role") or "user").lower()
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if role == "system":
            system_bits.append(content)
        else:
            user_bits.append(f"{role.upper()}: {content}" if role != "user" else content)
    prompt = "\n\n".join(user_bits) if user_bits else "Ahoj"
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 2048,
        },
    }
    if system_bits:
        body["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_bits)}]}

    async with httpx.AsyncClient(timeout=45.0) as client:
        last_err = ""
        for model in models:
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={settings.gemini_api_key}"
            )
            try:
                resp = await client.post(url, json=body)
            except Exception as exc:
                last_err = str(exc)[:180]
                logger.warning("Gemini %s request failed: %s", model, last_err)
                continue
            if resp.status_code != 200:
                last_err = (resp.text or "")[:180]
                logger.warning("Gemini %s HTTP %s: %s", model, resp.status_code, last_err)
                continue
            data = resp.json()
            candidates = data.get("candidates") or []
            if not candidates:
                # Often blocked by safety / empty — try next model
                last_err = str(data.get("promptFeedback") or data)[:180]
                logger.warning("Gemini %s no candidates: %s", model, last_err)
                continue
            parts = (candidates[0].get("content") or {}).get("parts") or []
            text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
            if text:
                return text
            last_err = f"empty parts finish={candidates[0].get('finishReason')}"
            logger.warning("Gemini %s empty text: %s", model, last_err)
    logger.warning("Gemini all models failed: %s", last_err[:200] if last_err else "unknown")
    return ""


async def _cloud_chat(messages: list[dict]) -> str:
    """Gemini only."""
    return await _gemini_chat(messages)


async def llm_complete(user_prompt: str, *, task: LLMTask = LLMTask.light, context: str = "") -> str:
    system = SYSTEM_CS
    if task == LLMTask.light:
        system = (
            "Jsi Sense / StockSense — stručný tržní rádce. "
            "Odpovídej česky, věcně, bez zbytečného markdownu. "
            "Nikdy nevymýšlej čísla: používej jen data z kontextu. "
            "Finální rozhodnutí dělá uživatel."
        )
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": f"Kontext (data):\n{context}\n\nÚkol:\n{user_prompt}" if context else user_prompt,
        },
    ]
    text = await _gemini_chat(messages)
    if not text:
        logger.warning("LLM fallback (%s): %s", task.value, llm_status_note())
        if task == LLMTask.light and context:
            note = llm_status_note()
            return (
                "Teď nedostávám odpověď od Gemini, takže jdu z pravidel / kontextu obrazovky.\n\n"
                f"{(context.strip()[:900] + ('…' if len(context.strip()) > 900 else ''))}\n\n"
                f"_({note})_"
            )
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
    text = await _gemini_chat(messages)
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


def _clean_sector_blurb(raw: str, fallback: str) -> str:
    text = (raw or "").strip()
    if not text:
        return fallback
    # Drop accidental markdown headings / bullets from the shared system prompt style.
    lines: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("#"):
            continue
        if s.startswith(("- ", "* ", "• ")):
            s = s[2:].strip()
        lines.append(s)
    joined = " ".join(lines)
    joined = re.sub(r"\s+", " ", joined).strip()
    if len(joined) < 40:
        return fallback
    if len(joined) > 420:
        cut = joined[:417].rsplit(" ", 1)[0]
        joined = f"{cut}…"
    return joined


async def narrate_market_sector(sector: dict) -> str:
    """2–3 sentence Czech market-state blurb for a homepage sector card."""
    fallback = str(sector.get("summary") or "Tržní data jsou omezená — ber hodnocení s rezervou.")
    benches = sector.get("benchmarks") or []
    bench_lines = []
    for b in benches:
        ch = b.get("change_pct")
        px = b.get("price")
        ch_s = f"{float(ch):+.2f}%" if ch is not None else "n/a"
        px_s = f"{float(px):.4g}" if px is not None else "n/a"
        bench_lines.append(f"- {b.get('name')} ({b.get('symbol')}): cena {px_s}, den {ch_s}")

    spark = sector.get("spark") or []
    range_note = "n/a"
    if len(spark) >= 2:
        try:
            a = float(spark[0]["close"])
            b = float(spark[-1]["close"])
            if a:
                range_note = f"{((b - a) / a) * 100:+.1f}% za ~{len(spark)} dní ({sector.get('chart_symbol')})"
        except (TypeError, ValueError, KeyError):
            pass

    avg = sector.get("avg_change_pct")
    avg_s = f"{float(avg):+.2f}%" if avg is not None else "n/a"
    ctx = (
        f"Sektor: {sector.get('label')} ({sector.get('id')})\n"
        f"Systémový bias: {sector.get('bias_label')} ({sector.get('bias')})\n"
        f"Průměrná denní změna benchmarků: {avg_s}\n"
        f"Trend grafu: {range_note}\n"
        f"Benchmarky:\n" + ("\n".join(bench_lines) if bench_lines else "- žádná data")
    )
    messages = [
        {
            "role": "system",
            "content": (
                "Jsi StockSense — stručný tržní komentátor. "
                "Odpovídej výhradně česky, 2 až 3 věty, bez markdownu, bez nadpisů, bez odrážek. "
                "Popiš obecný stav trhu v daném sektoru. "
                "Nikdy nevymýšlej čísla — používej jen data z kontextu. "
                "Neuváděj konkrétní obchodní tip (buy/sell), jen tón trhu."
            ),
        },
        {
            "role": "user",
            "content": (
                "Napiš krátký souhrn stavu tohoto trhu pro homepage kartu.\n\n"
                f"Kontext:\n{ctx}"
            ),
        },
    ]
    try:
        text = await _gemini_chat(messages)
        return _clean_sector_blurb(text, fallback)
    except Exception as exc:
        logger.warning("narrate_market_sector failed: %s", exc)
        return fallback
