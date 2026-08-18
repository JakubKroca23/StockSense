"use client";

import type { ReactNode } from "react";
import {
  DEFAULT_FP_VIZ,
  clampFpStatsFrac,
  fmtV,
  type FpHistAlign,
  type FpNumberMode,
  type FpPocStyle,
  type FpVizSettings,
} from "@/components/FootprintChart";
import type { FootprintViewMode } from "@/lib/orderflow";

type Props = {
  viz: FpVizSettings;
  onChange: (patch: Partial<FpVizSettings>) => void;
  onReset: () => void;
  barSpacing: number;
  onBarSpacing: (n: number) => void;
  onClose: () => void;
};

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (id: T) => void;
  options: { id: T; lab: string }[];
}) {
  return (
    <div className="fp-drawer__seg">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`fp-drawer__chip ${value === o.id ? "is-active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.lab}
        </button>
      ))}
    </div>
  );
}

function Item({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="fp-drawer__item">
      <div className="fp-drawer__item-top">
        <span>{label}</span>
        {value ? <span className="fp-drawer__item-val">{value}</span> : null}
      </div>
      <p className="fp-drawer__hint">{hint}</p>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="fp-drawer__toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="fp-drawer__toggle-lab">{label}</span>
        <span className="fp-drawer__hint">{hint}</span>
      </span>
    </label>
  );
}

export function FootprintSettingsPanel({
  viz,
  onChange,
  onReset,
  barSpacing,
  onBarSpacing,
  onClose,
}: Props) {
  const v = { ...DEFAULT_FP_VIZ, ...viz };
  const gammaPct = Math.round(((1.45 - (v.gamma ?? 0.55)) / (1.45 - 0.28)) * 100);

  return (
    <aside className="fp-drawer" aria-label="Nastavení footprintu">
      <header className="fp-drawer__head">
        <div>
          <p className="fp-drawer__title">Footprint</p>
          <p className="fp-drawer__sub">Změna se hned kreslí do grafu. Panel může zůstat otevřený.</p>
        </div>
        <button type="button" className="fp-drawer__close" onClick={onClose}>
          Zavřít
        </button>
      </header>

      <div className="fp-drawer__body">
        <p className="fp-drawer__note">
          Když jsou sloupce úzké (odzoomováno), čísla se schovají, aby se graf nesekal. Přiblíž kolečkem.
        </p>

        <section className="fp-drawer__sec">
          <h3>Sloupec a cena</h3>
          <p className="fp-drawer__lead">Jak široký je jeden časový sloupec a jak jemně se láme cena.</p>
          <Item
            label="Výška tabulky dole"
            value={`${Math.round(clampFpStatsFrac(v.statsFrac) * 100)} %`}
            hint="Chytni horní hranu tabulky na grafu a táhni. Dvojklik na hranu vrátí výchozí výšku."
          >
            <input
              type="range"
              min={10}
              max={48}
              value={Math.round(clampFpStatsFrac(v.statsFrac) * 100)}
              onChange={(e) => onChange({ statsFrac: Number(e.target.value) / 100 })}
            />
          </Item>
          <Item
            label="Šířka sloupce"
            value={`${barSpacing} px`}
            hint="Širší sloupec = víc místa na čísla Bid a Ask. Úzký sloupec je přehled na delší historii."
          >
            <input
              type="range"
              min={8}
              max={72}
              value={barSpacing}
              onChange={(e) => onBarSpacing(Number(e.target.value))}
            />
          </Item>
          <Item
            label="Sloučení ticků"
            value={`×${v.tickGroup || 1}`}
            hint="Seskupí sousední ceny do jedné buňky. ×1 je nejpřesnější, vyšší číslo zjednoduší graf u zlata a ropy."
          >
            <input
              type="range"
              min={1}
              max={20}
              value={v.tickGroup || 1}
              onChange={(e) => onChange({ tickGroup: Number(e.target.value) })}
            />
            <div className="fp-drawer__seg">
              {([1, 2, 5, 10, 20] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`fp-drawer__chip ${v.tickGroup === n ? "is-active" : ""}`}
                  onClick={() => onChange({ tickGroup: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </Item>
          <Item
            label="Šířka clusteru"
            value={`${Math.round((v.bodyWidth ?? 0.9) * 100)}%`}
            hint="Kolik z šířky svíčky zabere footprint. Nižší hodnota nechá víc mezery mezi sloupci."
          >
            <input
              type="range"
              min={40}
              max={100}
              value={Math.round((v.bodyWidth ?? 0.9) * 100)}
              onChange={(e) => onChange({ bodyWidth: Number(e.target.value) / 100 })}
            />
          </Item>
          <Item
            label="Mezera mezi cenami"
            value={`${(v.cellGap ?? 0.4).toFixed(1)} px`}
            hint="Svislá mezera mezi řádky. Větší mezera oddělí ceny, menší vyplní sloupec."
          >
            <input
              type="range"
              min={0}
              max={40}
              value={Math.round((v.cellGap ?? 0.4) * 10)}
              onChange={(e) => onChange({ cellGap: Number(e.target.value) / 10 })}
            />
          </Item>
          <Toggle
            checked={!!v.showZeros}
            onChange={(on) => onChange({ showZeros: on })}
            label="Prázdné ceny"
            hint="Doplní i ticky, kde se v té minutě neobchodovalo (nuly). Uvidíš díry v aukci."
          />
          <Toggle
            checked={!!v.cellGrid}
            onChange={(on) => onChange({ cellGrid: on })}
            label="Mřížka buněk"
            hint="Tenký rámeček kolem každé ceny. Pomáhá číst, když jsou barvy podobné."
          />
          <Item
            label="Skrýt malé obchody"
            value={v.minVolume <= 0 ? "vypnuto" : `pod ${fmtV(v.minVolume)}`}
            hint="Buňky s menším volume zmizí. Hodí se, když graf zahltí drobné ticky."
          >
            <input
              type="range"
              min={0}
              max={80}
              value={Math.min(80, Math.round(v.minVolume || 0))}
              onChange={(e) => onChange({ minVolume: Number(e.target.value) })}
            />
          </Item>
        </section>

        <section className="fp-drawer__sec">
          <h3>Barvy buněk</h3>
          <p className="fp-drawer__lead">Co říká výplň: kdo agresivně kupoval, kdo prodával, nebo jen kolik se toho zobchodovalo.</p>
          <Item
            label="Režim buněk"
            hint="B×A: vlevo prodeje (bid), vpravo nákupy (ask). Vol: celkové množství. Δ: rozdíl nákupy minus prodeje."
          >
            <Seg
              value={(v.view || "bidAsk") as FootprintViewMode}
              onChange={(id) => onChange({ view: id })}
              options={[
                { id: "bidAsk", lab: "Bid × Ask" },
                { id: "volume", lab: "Volume" },
                { id: "delta", lab: "Delta" },
              ]}
            />
          </Item>
          <Item
            label="S čím se srovnává sytost"
            hint="Svíčka: nejsytější je největší buňka v tom sloupci. Relace: srovnání proti celému zobrazenému období — uvidíš, které minuty byly opravdu velké."
          >
            <Seg
              value={(v.scale || "candle") as "candle" | "session"}
              onChange={(id) => onChange({ scale: id })}
              options={[
                { id: "candle", lab: "Tato svíčka" },
                { id: "session", lab: "Celá relace" },
              ]}
            />
          </Item>
          <Toggle
            checked={!!v.histogram}
            onChange={(on) => onChange({ histogram: on })}
            label="Šířka podle volume"
            hint="Zapnuto: pruh je jen tak široký, kolik se obchodovalo. Vypnuto: celá polovina buňky, sytost barvy ukazuje sílu (klasický footprint)."
          />
          {v.histogram ? (
            <Item
              label="Odkud pruh roste"
              hint="Split: bid doleva a ask doprava od středu. Vlevo: oba pruhy od levého okraje půlky. Střed: pruh vycentrovaný v půlce."
            >
              <Seg
                value={(v.histAlign || "split") as FpHistAlign}
                onChange={(id) => onChange({ histAlign: id, histogram: true })}
                options={[
                  { id: "split", lab: "Split" },
                  { id: "left", lab: "Vlevo" },
                  { id: "center", lab: "Střed" },
                ]}
              />
            </Item>
          ) : null}
        </section>

        <section className="fp-drawer__sec">
          <h3>Čísla</h3>
          <p className="fp-drawer__lead">Co je napsané v buňce. Může se lišit od barev — třeba barvy Bid×Ask a v čísle jen delta.</p>
          <Toggle
            checked={v.numbers}
            onChange={(on) => onChange({ numbers: on })}
            label="Zobrazit čísla"
            hint="Vypni, když chceš jen barevný cluster bez textu (rychlejší a čistší při odzoomování)."
          />
          <Item
            label="Jaké číslo"
            hint="Auto kopíruje režim buněk. Bid×Ask ukáže dvě čísla. Volume jedno. Delta rozdíl se znaménkem."
          >
            <Seg
              value={(v.numberMode || "auto") as FpNumberMode}
              onChange={(id) => onChange({ numberMode: id, numbers: true })}
              options={[
                { id: "auto", lab: "Auto" },
                { id: "bidAsk", lab: "B×A" },
                { id: "volume", lab: "Vol" },
                { id: "delta", lab: "Δ" },
              ]}
            />
          </Item>
          <Toggle
            checked={!!v.numberBySide}
            onChange={(on) => onChange({ numberBySide: on })}
            label="Čísla barvou strany"
            hint="Prodeje červeně, nákupy zeleně. Vypnuto = jedna barva textu (níže v Barvách)."
          />
          <Toggle
            checked={v.textShadow === true}
            onChange={(on) => onChange({ textShadow: on })}
            label="Stín pod textem"
            hint="Lepší čitelnost na sytých buňkách. Na slabším počítači nech vypnuté."
          />
          <Item
            label="Velikost písma"
            value={`${Math.round((v.fontScale ?? 1) * 100)}%`}
            hint="Zvětši, když sloupce už jsou dost široké a čísla chceš číst z dálky."
          >
            <input
              type="range"
              min={55}
              max={190}
              value={Math.round((v.fontScale ?? 1) * 100)}
              onChange={(e) => onChange({ fontScale: Number(e.target.value) / 100 })}
            />
          </Item>
          <Item
            label="Skrýt malá čísla"
            value={v.numberMin <= 0 ? "vypnuto" : `pod ${fmtV(v.numberMin)}`}
            hint="Nuly a drobné ticky se nevykreslí. Graf je klidnější, velké obchody vyniknou."
          >
            <input
              type="range"
              min={0}
              max={50}
              value={Math.min(50, Math.round(v.numberMin || 0))}
              onChange={(e) => onChange({ numberMin: Number(e.target.value) })}
            />
          </Item>
        </section>

        <section className="fp-drawer__sec">
          <h3>Zvýraznění</h3>
          <p className="fp-drawer__lead">Co ti footprint má samo ukázat — kde se obchodovalo nejvíc a kde aukce „nedoběhla“.</p>
          <Toggle
            checked={v.wicks}
            onChange={(on) => onChange({ wicks: on })}
            label="Knoty (high / low)"
            hint="Svislá čára od maxima po minimum svíčky uprostřed sloupce."
          />
          <Toggle
            checked={v.poc}
            onChange={(on) => onChange({ poc: on })}
            label="POC — místo největšího volume"
            hint="Point of Control: cena, kde se v té svíčce zobchodovalo nejvíc. Sem se trh často vrací."
          />
          <Item
            label="Jak kreslit POC"
            hint="Rám = jen okraj buňky. Výplň = celá buňka zabarvená. Obojí je nejvýraznější."
          >
            <Seg
              value={(v.pocStyle || "box") as FpPocStyle}
              onChange={(id) => onChange({ pocStyle: id, poc: true })}
              options={[
                { id: "box", lab: "Rám" },
                { id: "fill", lab: "Výplň" },
                { id: "both", lab: "Obojí" },
              ]}
            />
          </Item>
          <Toggle
            checked={!!v.valueArea}
            onChange={(on) => onChange({ valueArea: on })}
            label="Value area (~70 % volume)"
            hint="Pásmo kolem POC, kde se udála většina obchodů. Mimo něj je cena „mimo hodnotu“."
          />
          <Toggle
            checked={v.lvn !== false}
            onChange={(on) => onChange({ lvn: on })}
            label="LVN — tenké místo"
            hint="Low Volume Node: cena s málo obchody. Trh tudy často proskočí rychle."
          />
          <Item
            label="Jak přísný je LVN"
            value={`${Math.round((v.lvnPct ?? 0.2) * 100)} % vrcholu`}
            hint="Nižší = jen opravdu prázdné díry. Vyšší = víc označených slabých cen."
          >
            <input
              type="range"
              min={5}
              max={50}
              value={Math.round((v.lvnPct ?? 0.2) * 100)}
              onChange={(e) => onChange({ lvnPct: Number(e.target.value) / 100, lvn: true })}
            />
          </Item>
          <Toggle
            checked={!!v.hvn}
            onChange={(on) => onChange({ hvn: on })}
            label="HVN — tlusté místo"
            hint="High Volume Node: lokální špička volume (ne POC). Často se tam cena „lepí“."
          />
          <Item
            label="Jak přísný je HVN"
            value={`${Math.round((v.hvnPct ?? 0.75) * 100)} % vrcholu`}
            hint="Výš = jen téměř stejně silné jako POC. Níž = víc označených špiček."
          >
            <input
              type="range"
              min={50}
              max={95}
              value={Math.round((v.hvnPct ?? 0.75) * 100)}
              onChange={(e) => onChange({ hvnPct: Number(e.target.value) / 100, hvn: true })}
            />
          </Item>
          <Toggle
            checked={v.unfinished}
            onChange={(on) => onChange({ unfinished: on })}
            label="Unfinished auction"
            hint="Na high chybí prodeje, nebo na low chybí nákupy. Aukce tam „nedoběhla“ — trh se sem často vrací."
          />
          <Item
            label="Velikost šipek UA"
            value={`${Math.round((v.uaScale ?? 1) * 100)}%`}
            hint="Jak velké jsou trojúhelníky na nedokončené aukci."
          >
            <input
              type="range"
              min={50}
              max={160}
              value={Math.round((v.uaScale ?? 1) * 100)}
              onChange={(e) => onChange({ uaScale: Number(e.target.value) / 100, unfinished: true })}
            />
          </Item>
          <Toggle
            checked={!!v.candleDelta}
            onChange={(on) => onChange({ candleDelta: on })}
            label="Delta nad svíčkou"
            hint="Součet nákupy minus prodeje za celý sloupec, napsaný nad ním."
          />
          <Toggle
            checked={!!v.candleVolume}
            onChange={(on) => onChange({ candleVolume: on })}
            label="Volume nad svíčkou"
            hint="Celkové volume sloupce nad clusterem. Dole v tabulce je pořád Vol / Δ / CVD."
          />
        </section>

        <section className="fp-drawer__sec">
          <h3>Imbalance</h3>
          <p className="fp-drawer__lead">
            Srovnává se šikmo: prodeje na ceně P proti nákupům o tick výš. Když je jedna strana mnohonásobně silnější, číslo se zvýrazní — někdo tam agresivně tlačil.
          </p>
          <Item
            label="Práh"
            value={v.imbalance <= 0 ? "vypnuto" : `${v.imbalance.toFixed(1)}× silnější`}
            hint="3× znamená: bid je aspoň třikrát větší než ask o tick výš (nebo naopak). 0 vypne zvýraznění. Běžné je 2,5–4."
          >
            <input
              type="range"
              min={0}
              max={80}
              value={Math.round(v.imbalance * 10)}
              onChange={(e) => onChange({ imbalance: Number(e.target.value) / 10 })}
            />
          </Item>
          <Item
            label="Řada za sebou"
            value={v.imbalanceStack <= 1 ? "každá" : `${v.imbalanceStack} ticků`}
            hint="1 = ukaž každou takovou buňku. 3 = jen když jsou tři sousední ceny v řadě stejnou stranou — to je silnější signál."
          >
            <input
              type="range"
              min={1}
              max={8}
              value={v.imbalanceStack || 1}
              onChange={(e) => onChange({ imbalanceStack: Number(e.target.value) })}
            />
          </Item>
          <Toggle
            checked={!!v.imbExtend}
            onChange={(on) => onChange({ imbExtend: on })}
            label="Prodloužit doprava"
            hint="Čáry od stacked imbalance vedou k poslední svíčce. Když se cena později vrátí na tu úroveň, čára tam skončí — vidíš, jestli už to trh sebral."
          />
          <Item
            label="Síla zvýraznění"
            value={`${Math.round((v.imbFill ?? 0.22) * 100)}%`}
            hint="Jak sytě se podbarví strana s imbalancí."
          >
            <input
              type="range"
              min={0}
              max={50}
              value={Math.round((v.imbFill ?? 0.22) * 100)}
              onChange={(e) => onChange({ imbFill: Number(e.target.value) / 100 })}
            />
          </Item>
        </section>

        <section className="fp-drawer__sec">
          <h3>Barvy a sytost</h3>
          <p className="fp-drawer__lead">Vlastní paleta. Kontrast dělá velké obchody výraznější, výplň celou sytost.</p>
          <div className="fp-drawer__colors">
            {(
              [
                ["buyColor", "Nákupy", "Ask / lift — kdo kupoval tržní objednávkou"],
                ["sellColor", "Prodeje", "Bid / hit — kdo prodával tržní objednávkou"],
                ["numberColor", "Text", "Barva čísel, pokud nemáš zapnuté „barvou strany“"],
                ["pocColor", "POC", "Rám / výplň nejsilnější ceny"],
                ["lvnColor", "LVN", "Tenké (prázdné) místo"],
                ["hvnColor", "HVN", "Tlusté (plné) místo"],
                ["uaColor", "UA", "Nedokončená aukce"],
                ["vaColor", "Value area", "Pásmo 70 % volume"],
                ["imbAskColor", "Imb. nákup", "Zvýraznění ask imbalance"],
                ["imbBidColor", "Imb. prodej", "Zvýraznění bid imbalance"],
              ] as const
            ).map(([key, lab, hint]) => (
              <label key={key} className="fp-drawer__color" title={hint}>
                <input
                  type="color"
                  value={v[key] || DEFAULT_FP_VIZ[key]}
                  onChange={(e) => onChange({ [key]: e.target.value } as Partial<FpVizSettings>)}
                />
                <span>
                  <span className="fp-drawer__color-lab">{lab}</span>
                  <span className="fp-drawer__hint">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <Item
            label="Kontrast velkých vs malých"
            value={`${gammaPct}`}
            hint="Výš = malé obchody skoro zmizí, velké svítí. Níž = i slabé ticky jsou vidět."
          >
            <input
              type="range"
              min={0}
              max={100}
              value={gammaPct}
              onChange={(e) =>
                onChange({ gamma: 1.45 - (Number(e.target.value) / 100) * (1.45 - 0.28) })
              }
            />
          </Item>
          <Item
            label="Celková sytost"
            value={`${Math.round((v.fill ?? 0.88) * 100)}%`}
            hint="Průhlednost barevných výplní. Nižší hodnota nechá víc prosvítat svíčky a heatmapu."
          >
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round((v.fill ?? 0.88) * 100)}
              onChange={(e) => onChange({ fill: Number(e.target.value) / 100 })}
            />
          </Item>
          <Item
            label="Tmavé pozadí buněk"
            value={`${Math.round((v.cellBg ?? 0.16) * 100)}%`}
            hint="Černý podklad pod každou cenu. Pomáhá oddělit cluster od grafu."
          >
            <input
              type="range"
              min={0}
              max={70}
              value={Math.round((v.cellBg ?? 0.16) * 100)}
              onChange={(e) => onChange({ cellBg: Number(e.target.value) / 100 })}
            />
          </Item>
        </section>

        <button type="button" className="fp-drawer__reset" onClick={onReset}>
          Výchozí vzhled
        </button>
      </div>
    </aside>
  );
}
