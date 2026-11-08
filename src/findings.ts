import { getLang, type Lang } from "./i18n";

// Findings in project language. The repos' tools report in English, with
// file paths and schema terms ("storage_type 'HBR': ... not found in
// elements/storage_technologies.yaml"). This turns them into German
// sentences with a readable location; the original stays available.

export interface Finding {
  /** Where: repo, customer, hall or category, and what the file holds. */
  location: string;
  /** What: e.g. "Tor DOOR_01". */
  subject: string;
  /** The finding as a German sentence; the original text if no pattern knows it. */
  text: string;
  /** The tool's own line. */
  original: string;
  /** Whether a pattern translated the message itself, not only location and subject. */
  translated: boolean;
}

const REPO_LABEL: Record<string, string> = {
  "Topology-as-Code": "Topologie",
  "Allocation-as-Code": "Allocation",
  "OrderOrchestration-as-Code": "Aufträge",
  "MasterData-as-Code": "Stammdaten",
  "Warehouse-as-Code": "Standorte",
};

/** What a file holds, by its name. */
const FILE_LABEL: Record<string, string> = {
  "company.yaml": "Firma",
  "facility.yaml": "Standort",
  "warehouse.yaml": "Halle",
  "storage.yaml": "Lagerstruktur",
  "lanes.yaml": "Verbindungen",
  "wcs.yaml": "Steuerungen und Meldepunkte",
  "scan_codes.yaml": "Scan-Codes",
  "movement_rules.yaml": "Bewegungsregeln",
  "replenishment.yaml": "Nachschub",
  "allocation.yaml": "Allocation der Halle",
  "fields.yaml": "Felder",
  "search_rules.yaml": "Suchregeln",
  "putaway_rules.yaml": "Einlagerregeln",
  "fixed_bin_assignments.yaml": "Festplätze",
  "area_assignments.yaml": "Bereichszuordnungen",
  "owner_zones.yaml": "Eigentümer-Zonen",
  "category.yaml": "Kategorie",
  "items.yaml": "Artikelstamm",
  "packaging.yaml": "Verpackungen",
  "sourcing.yaml": "Beschaffung",
  "lifecycle.yaml": "Lebenszyklus",
  "load_unit_types.yaml": "Ladungsträger",
  "channel.yaml": "Kanal",
  "order_type.yaml": "Auftragsart",
  "status.yaml": "Status",
  "split_rules.yaml": "Split-Regeln",
  "workflow_triggers.yaml": "Workflow-Trigger",
  "completion_rules.yaml": "Abschlussregeln",
  "shortage_policy.yaml": "Fehlmengen-Regel",
};

/** German names of the things findings are about, singular. */
export const ENTITY: Record<string, string> = {
  storage_type: "Lagertyp",
  storage_types: "Lagertyp",
  storage_point: "Lagerplatz",
  section: "Abschnitt",
  activity_area: "Aktivitätsbereich",
  activity_areas: "Aktivitätsbereich",
  work_center: "Arbeitsplatz",
  work_centers: "Arbeitsplatz",
  door: "Tor",
  doors: "Tor",
  controller: "Steuerung",
  controller_definitions: "Steuerung",
  reporting_point: "Meldepunkt",
  reporting_points: "Meldepunkt",
  equipment: "Gerät",
  telegram_action: "Telegrammaktion",
  connection: "Verbindung",
  connections: "Verbindung",
  lane: "Fahrweg",
  lanes: "Fahrweg",
  conveyor_segment: "Förderabschnitt",
  conveyor_segments: "Förderabschnitt",
  movement_rule: "Bewegungsregel",
  movement_rules: "Bewegungsregel",
  replenishment_strategy: "Nachschubstrategie",
  replenishment_strategies: "Nachschubstrategie",
  scan_code: "Scan-Code",
  item: "Artikel",
  items: "Artikel",
  packaging: "Verpackung",
  sourcing: "Beschaffung",
  lifecycle: "Lebenszyklus",
  category: "Kategorie",
  load_unit_type: "Ladungsträger",
  load_unit_types: "Ladungsträger",
  search_rule: "Suchregel",
  search_rules: "Suchregel",
  putaway_rule: "Einlagerregel",
  putaway_rules: "Einlagerregel",
  fixed_bin_assignment: "Festplatz",
  fixed_bin_assignments: "Festplatz",
  area_assignment: "Bereichszuordnung",
  area_assignments: "Bereichszuordnung",
  owner_zone: "Eigentümer-Zone",
  owner_zones: "Eigentümer-Zone",
  split_rule: "Split-Regel",
  split_rules: "Split-Regel",
  workflow_trigger: "Workflow-Trigger",
  workflow_triggers: "Workflow-Trigger",
  completion_rule: "Abschlussregel",
  completion_rules: "Abschlussregel",
  status: "Status",
  statuses: "Status",
  transition: "Statusübergang",
  transitions: "Statusübergang",
  order_type: "Auftragsart",
  order_types: "Auftragsart",
  channel: "Kanal",
  building: "Halle",
  facility: "Standort",
  site: "Standort",
  "site id": "Standort-ID",
  owner: "Eigentümer",
  positions: "Position",
  item_id: "Artikel",
  substitute_item_id: "Ersatzartikel",
  conveyor_main: "Hauptförderer",
  warehouse: "Halle",
  coordinate: "Koordinate",
  "load unit type": "Ladungsträger",
  steps: "Schritt",
};

const TYPE: Record<string, string> = {
  string: "Text",
  integer: "ganze Zahl",
  number: "Zahl",
  boolean: "ja/nein",
  object: "Abschnitt mit Feldern",
  array: "Liste",
  null: "leer",
};

const REPO_IN: Record<string, string> = {
  "Topology-as-Code": "in der Topologie",
  "Allocation-as-Code": "in Allocation",
  "OrderOrchestration-as-Code": "in OrderOrchestration",
  "MasterData-as-Code": "in den Stammdaten",
  "Warehouse-as-Code": "in Warehouse-as-Code",
};
const inRepo = (repo: string) => REPO_IN[repo] ?? `in ${repo}`;

/** A quoted value from a tool message: 'x' → „x“. */
const q = (value: string) => `„${value.replace(/^['"]|['"]$/g, "")}“`;
const names = (list: string) => list.split(/,\s*/).map((v) => q(v.trim())).join(", ");
const types = (list: string) =>
  list
    .split(/,\s*/)
    .map((t) => TYPE[t.replace(/'/g, "").trim()] ?? t)
    .join(" oder ");
/** A field or entity name from the tools: storage_type → Lagertyp, else the name in quotes. */
const thing = (word: string) => ENTITY[word] ?? q(word);
const ROLE: Record<string, string> = {
  storage_condition: "Lagerbedingung", hazmat_classes: "Gefahrstoffklasse", default_uom: "Mengeneinheit", uom: "Mengeneinheit",
  technology: "Lagertechnik", condition: "Split-Grund", split_by: "Split-Dimension", trigger: "Trigger",
  selection_strategy: "Auswahlstrategie", placement_strategy: "Platzierungsstrategie", automation_level: "Automatisierungsgrad",
  blocked_reason: "Sperrgrund", template: "Vorlage", workstation_template: "Arbeitsplatzvorlage", step: "Prozessschritt",
  from: "Start", to: "Ziel", exclude_to: "Ausgeschlossenes Ziel", connects: "Der verbundene Knoten",
  served_point: "Der bediente Meldepunkt", from_point: "Der Startpunkt", to_point: "Der Zielpunkt", next_target: "Das nächste Ziel",
};
/** A value with what it is: "Lagertyp „HBR“", or "der Wert „x“ in „field“" for plain fields. */
const val = (field: string, value: string) => {
  const last = field.split(/[ .]/).pop() ?? field;
  const name = ENTITY[field] ?? ROLE[field] ?? ENTITY[last] ?? ROLE[last];
  return name ? `${name} ${q(value)}` : `Der Wert ${q(value)} in ${q(fieldPath(field))}`;
};
/** Where a reference should resolve: structure/items.yaml → "im Artikelstamm". */
const IN: Record<string, string> = {
  statuses: "unter den Status",
  reporting_points: "unter den Meldepunkten",
  controller_definitions: "unter den Steuerungen",
  "topology endpoints": "unter den Knoten der Topologie",
  "storage_types/doors/work_centers": "unter den Lagertypen, Toren und Arbeitsplätzen",
  "storage_types/doors/reporting_points/work_centers": "unter den Lagertypen, Toren, Meldepunkten und Arbeitsplätzen",
};
const inFile = (where: string) => {
  if (IN[where]) return IN[where];
  if (/controller_definitions$/.test(where)) return "unter den Steuerungen";
  const label = FILE_LABEL[where.split(" ")[0].split("/").pop() ?? ""];
  return label ? `in der Datei ${q(label)}` : `in ${where}`;
};
/** A catalog file: elements/storage_technologies.yaml → Katalog storage_technologies. */
const catalog = (path: string) => {
  const m = /(?:([A-Za-z]+-as-Code)(?:'s)?\s+)?elements\/([a-z_]+)\.yaml/.exec(path);
  return m ? `im Katalog ${q(m[2])}${m[1] ? ` (${REPO_LABEL[m[1]] ?? m[1]})` : ""}` : `in ${path}`;
};

type Rule = [RegExp, (m: RegExpMatchArray) => string];

/** Message patterns, most specific first. Each turns the rest of a finding (after location and subject) into German. */
const RULES: Rule[] = [
  // JSON Schema (jsonschema's messages)
  [/^'([^']+)' is a required property$/, (m) => `Pflichtfeld ${q(m[1])} fehlt.`],
  [/^Additional properties are not allowed \((.+) (?:was|were) unexpected\)$/, (m) => `Feld ${names(m[1])} ist im Schema nicht vorgesehen.`],
  [/^(.+) is not one of \[(.*)\]$/, (m) => `${q(m[1])} ist kein erlaubter Wert. Erlaubt: ${names(m[2])}.`],
  [/^(.+) is not of type (.+)$/, (m) => `${q(m[1])} hat den falschen Typ, erwartet: ${types(m[2])}.`],
  [/^(.+) is less than the minimum of (.+)$/, (m) => `${q(m[1])} ist kleiner als das Minimum ${m[2]}.`],
  [/^(.+) is less than or equal to the minimum of (.+)$/, (m) => `${q(m[1])} muss größer als ${m[2]} sein.`],
  [/^(.+) is greater than the maximum of (.+)$/, (m) => `${q(m[1])} ist größer als das Maximum ${m[2]}.`],
  [/^(.+) does not match '(.+)'$/, (m) => `${q(m[1])} hat nicht das vorgeschriebene Format (${m[2]}).`],
  [/^(\[\]|\{\}) should be non-empty$|^(\[\]|\{\}) is too short$/, () => "Darf nicht leer sein."],
  [/^'(.*)' is too short$/, (m) => `${q(m[1])} ist zu kurz.`],
  [/^(.+) has non-unique elements$/, () => "Die Liste enthält einen Eintrag doppelt."],
  [/^(.+) is not valid under any of the given schemas$/, () => "Passt zu keiner der erlaubten Varianten."],
  [/^(.+) is valid under each of (.+)$/, () => "Passt zu mehreren Varianten, erlaubt ist genau eine."],
  [/^(.+) was expected$/, (m) => `Erwartet wird ${q(m[1])}.`],
  [/^'(.+)' is a dependency of '(.+)'$/, (m) => `${q(m[2])} verlangt zusätzlich das Feld ${q(m[1])}.`],
  [/^(.+) should not be valid under (.+)$/, () => "Diese Kombination von Feldern ist nicht erlaubt."],
  [/^(.+) is too long$/, () => "Zu viele Einträge."],

  // References between files and repos
  [/^load_unit_type '([^']*)' not found in elements\/load_unit_types\.yaml or the customer's load_unit_types\.yaml$/, (m) => `Ladungsträger ${q(m[1])} steht weder im globalen Katalog noch bei den Ladungsträgern des Kunden.`],
  [/^([a-z_. ]+?) '([^']*)' not found in ((?:[A-Za-z]+-as-Code'?s? )?elements\/[a-z_]+\.yaml)( [a-z_]+| \(pinned copy of [^)]*\))?$/, (m) => `${val(m[1], m[2])} ist ${catalog(m[3])} nicht vorhanden${m[4] ? (m[4].includes("pinned") ? " (Kopie des Katalogs der Stammdaten)" : ` (Liste ${q(m[4].trim())})`) : ""}.`],
  [/^([a-z_. ]+?) '([^']*)' not in (?:structure\/)?fields\.yaml ([a-z_]+)$/, (m) => `${val(m[1], m[2])} ist in den Feldern der Halle nicht freigegeben (${m[3]}).`],
  [/^zone type '([^']*)' is not in fields\.yaml ([a-z_]+)$/, (m) => `Zonentyp ${q(m[1])} ist in den Feldern der Halle nicht freigegeben (${m[2]}).`],
  [/^item '([^']*)' not in MasterData$/, (m) => `Artikel ${q(m[1])} gibt es in den Stammdaten nicht.`],
  [/^([\w.[\]]+) not found in ([A-Za-z]+-as-Code): (.+)$/, (m) => `${fieldPath(m[1])}: ${m[3]} gibt es ${inRepo(m[2])} nicht.`],
  [/^([\w.[\]]+) '([^']*)' is not under (customers\/[^/]+\/)$/, (m) => `${fieldPath(m[1])}: ${q(m[2])} liegt nicht im Ordner des Kunden (${m[3]}).`],
  [/^imported file missing: (.+)$/, (m) => `Die importierte Datei ${m[1]} fehlt.`],
  [/^([a-z_]+) file missing: (.+)$/, (m) => `Die Datei für ${thing(m[1])} fehlt: ${m[2]}.`],
  [/^building '([^']*)' is in Topology but has no Allocation building$/, (m) => `Halle ${q(m[1])} gibt es in der Topologie, aber nicht in Allocation.`],
  [/^building '([^']*)' is in Allocation but not in Topology$/, (m) => `Halle ${q(m[1])} gibt es in Allocation, aber nicht in der Topologie.`],
  [/^'([^']*)' is not listed by any channel of the company$/, (m) => `${q(m[1])} gehört zu keinem Kanal der Firma.`],
  [/^names building '([^']*)', not in the Topology facility$/, (m) => `nennt Halle ${q(m[1])}, die es am Topologie-Standort nicht gibt.`],
  // Allocation
  [/^item already has an area assignment for this zone$/, () => "Der Artikel hat für diese Zone schon eine Bereichszuordnung."],
  [/^sequence (-?\d+) already used for this item at '([^']*)'$/, (m) => `Reihenfolge ${m[1]} ist für diesen Artikel schon bei ${q(m[2])} vergeben.`],
  [/^duplicate assignment of the same item to the same storage_point$/, () => "Derselbe Artikel ist demselben Lagerplatz doppelt zugeordnet."],
  [/^and '([^']*)' both omit applies_to \(ambiguous default\)$/, (m) => `Auch ${q(m[1])} hat kein applies_to. Nur eine Regel je Halle darf die Standardregel sein.`],
  [/^storage_point '([^']*)' not in the Topology building$/, (m) => `Lagerplatz ${q(m[1])} gibt es in dieser Halle der Topologie nicht.`],
  [/^R11 item '([^']*)' needs '([^']*)', but no step zone has such a place \(only (.+)\)$/, (m) => `Regel R11: Artikel ${q(m[1])} braucht ${q(m[2])}, aber keine Zone der Schritte bietet das (nur ${m[3]}).`],
  [/^R3 allow_mixed_lots has no effect, every item it serves has lot tracking '([^']*)'$/, (m) => `Regel R3: allow_mixed_lots wirkt nicht, jeder Artikel dieser Regel hat die Chargenführung ${q(m[1])}.`],
  [/^R1 uses FEFO for item '([^']*)', which has no tracked expiry$/, (m) => `Regel R1: FEFO für Artikel ${q(m[1])}, der kein Verfallsdatum führt.`],
  [/^R2 shelf-life floor (-?\d+) days exceeds item '([^']*)' total shelf life (-?\d+) days; no stock can qualify$/, (m) => `Regel R2: Die Mindestrestlaufzeit von ${m[1]} Tagen ist länger als die Haltbarkeit von Artikel ${q(m[2])} (${m[3]} Tage). Kein Bestand kann passen.`],

  // MasterData
  [/^tracking\.expiry (.+) set but expiry is not tracked$/, (m) => `${names(m[1])} sind gesetzt, aber das Verfallsdatum wird nicht geführt (tracking.expiry.tracked).`],
  [/^barcode '([^']*)' on (\S+) already used on (\S+) within the company$/, (m) => `Barcode ${q(m[1])} an ${m[2]} ist in der Firma schon an ${m[3]} vergeben.`],

  // OrderOrchestration
  [/^action\.supersedes_parent is true but no transition in structure\/status\.yaml reaches '([^']*)'$/, (m) => `supersedes_parent ist gesetzt, aber kein Statusübergang führt nach ${q(m[1])}.`],
  [/^when\.dimension_value '([^']*)' is already claimed by split_rule '([^']*)' for split_by '([^']*)'$/, (m) => `Der Wert ${q(m[1])} für ${q(m[3])} gehört schon zur Split-Regel ${q(m[2])}.`],
  [/^when\.dimension_value is required because another split_rule also splits by '([^']*)'.*$/, (m) => `when.dimension_value fehlt: Eine weitere Split-Regel teilt auch nach ${q(m[1])}, ohne den Wert sind die Regeln nicht zu unterscheiden.`],
  [/^shortage_policy\.allowed_overrides repeats the default '([^']*)'$/, (m) => `allowed_overrides wiederholt den Standardwert ${q(m[1])}.`],
  [/^trigger '([^']*)' is not a Topology process_type$/, (m) => `Trigger ${q(m[1])} ist kein Prozesstyp der Topologie.`],

  // Topology
  [/^duplicate extension record (\S+)$/, (m) => `Der Erweiterungseintrag ${m[1]} kommt doppelt vor.`],
  [/^extension record (\S+): '([^']*)' is not a compiled entity type .*$/, (m) => `Erweiterungseintrag ${m[1]}: ${q(m[2])} ist kein bekannter Elementtyp.`],
  [/^extension record (\S+) references an unknown entity$/, (m) => `Der Erweiterungseintrag ${m[1]} verweist auf ein Element, das es nicht gibt.`],
  [/^extension\.dataset_id '([^']*)' does not match warehouse dataset_id '([^']*)'$/, (m) => `dataset_id ${q(m[1])} passt nicht zur Halle (${q(m[2])}).`],
  [/^applies_to_policy '([^']*)' contradicts referenced storage_type policy '([^']*)'$/, (m) => `applies_to_policy ${q(m[1])} widerspricht der Regel des Lagertyps (${q(m[2])}).`],
  [/^no directed topology path from '([^']*)' to '([^']*)'$/, (m) => `In der Topologie gibt es keinen Weg von ${q(m[1])} nach ${q(m[2])}.`],
  [/^scan code '([^']*)' is used by both '([^']*)' and '([^']*)'$/, (m) => `Scan-Code ${q(m[1])} ist doppelt vergeben: ${q(m[2])} und ${q(m[3])}.`],
  [/^scan code for unknown storage_point '([^']*)'$/, (m) => `Scan-Code für den unbekannten Lagerplatz ${q(m[1])}.`],
  [/^has more than one scan code$/, () => "Hat mehr als einen Scan-Code."],
  [/^staging_section '([^']*)' is not in '([^']*)' format$/, (m) => `staging_section ${q(m[1])} hat nicht das Format ${m[2]}.`],
  [/^duplicate (?:[a-z_]+ )*?([a-z_]+) id '([^']*)'$/, (m) => `${thing(m[1])} ${q(m[2])} gibt es mehrfach.`],
  [/^reporting_point storage_point_ref id '([^']*)' collides with a compiled storage_point id$/, (m) => `Meldepunkt ${q(m[1])}: Sein Lagerplatz (storage_point_ref) hat dieselbe ID wie ein erzeugter Lagerplatz.`],
  [/^default_attributes: capacity_per_point (-?[\d.]+) must equal (-?[\d.]+) from (.+)$/, (m) => `Standardwerte: capacity_per_point ${m[1]} muss ${m[2]} sein (aus ${m[3]}).`],
  [/^default_attributes: load_unit_type '([^']*)' design weight (-?[\d.]+) kg exceeds max_weight (-?[\d.]+) kg$/, (m) => `Standardwerte: Ladungsträger ${q(m[1])} ist für ${m[2]} kg ausgelegt, mehr als max_weight ${m[3]} kg.`],
  [/^default_attributes: load_unit_type '([^']*)' dimensions (\S+) m do not fit per-position envelope (\S+) m$/, (m) => `Standardwerte: Ladungsträger ${q(m[1])} (${m[2]} m) passt nicht in den Platz (${m[3]} m).`],
  [/^default_attributes: (-?[\d.]+) x load_unit_type '([^']*)' requires (-?[\d.]+) m3, exceeding capacity_volume (-?[\d.]+) m3$/, (m) => `Standardwerte: ${m[1]} × Ladungsträger ${q(m[2])} brauchen ${m[3]} m³, mehr als capacity_volume ${m[4]} m³.`],
  [/^default_attributes: capacity_volume (-?[\d.]+) m3 exceeds geometric envelope (-?[\d.]+) m3$/, (m) => `Standardwerte: capacity_volume ${m[1]} m³ ist größer als der Platz (${m[2]} m³).`],
  [/^default_attributes\.allowed_load_unit_types '([^']*)' not in the global catalog elements\/load_unit_types\.yaml.*$/, (m) => `Ladungsträger ${q(m[1])} steht nicht im globalen Katalog. Ist es ein kundeneigener, prüft ihn Warehouse-as-Code je Standort; die Maßprüfungen entfallen.`],
  [/^temperature_zone (\S+) C lies outside storage_condition '([^']*)' \((\S+) C\)$/, (m) => `Der Temperaturbereich ${m[1]} °C liegt außerhalb der Lagerbedingung ${q(m[2])} (${m[3]} °C).`],
  [/^section '([^']*)' has no members$/, (m) => `Abschnitt ${q(m[1])} enthält keine Lagerplätze.`],
  [/^coordinate '([^']*)' matches multiple sections \[(.*)\]$/, (m) => `Koordinate ${q(m[1])} gehört zu mehreren Abschnitten: ${names(m[2])}.`],
  [/^bins_from '([^']*)': storage_type '([^']*)' not found$/, (m) => `bins_from ${q(m[1])}: Lagertyp ${q(m[2])} gibt es nicht.`],

  [/^owner '([^']*)' not in MasterData$/, (m) => `Eigentümer ${q(m[1])} gibt es in den Stammdaten nicht.`],
  [/^is in Topology but has no Allocation building$/, () => "gibt es in der Topologie, aber nicht in Allocation."],
  [/^is in Allocation but not in Topology$/, () => "gibt es in Allocation, aber nicht in der Topologie."],
  [/^(.*?)\s*(?:allowed_load_unit_types|load_unit_type) '([^']*)' not in the global catalog elements\/load_unit_types\.yaml.*$/, (m) => `${m[1] ? `${fieldPath(m[1].replace(/'([^']*)'/g, "$1"))}: ` : ""}Ladungsträger ${q(m[2])} steht nicht im globalen Katalog. Ist es ein kundeneigener, prüft ihn Warehouse-as-Code je Standort; die Maßprüfungen entfallen.`],
  [/^via_segment '([^']*)' connects (\S+) -> (\S+), which does not match the rule endpoints$/, (m) => `Förderabschnitt ${q(m[1])} verbindet ${m[2]} → ${m[3]}, das passt nicht zu Start und Ziel der Regel.`],
  [/^duplicate exceptions coordinate '([^']*)'$/, (m) => `Die Ausnahme für Koordinate ${q(m[1])} kommt doppelt vor.`],
  [/^exception coordinate '([^']*)' does not match (?:a|any) generated (?:storage )?point(?: \(typo\?\))?$/, (m) => `Die Ausnahme für Koordinate ${q(m[1])} trifft keinen erzeugten Lagerplatz.`],
  [/^load_limits exception for aisle (-?\d+) bay (-?\d+) names no existing bay$/, (m) => `Die load_limits-Ausnahme für Gasse ${m[1]}, Fach ${m[2]} nennt ein Fach, das es nicht gibt.`],
  [/^routing aisle (-?\d+) has no storage_points$/, (m) => `Fahrgasse ${m[1]} hat keine Lagerplätze.`],
  [/^layout_variant '([^']*)': layout_grid\.levels > (\d+) needs \{level\} in coordinate_pattern$/, (m) => `Layout-Variante ${q(m[1])}: Bei mehr als ${m[2]} Ebene braucht coordinate_pattern den Platzhalter {level}.`],
  [/^coordinate '([^']*)' has no section$/, (m) => `Koordinate ${q(m[1])} gehört zu keinem Abschnitt.`],
  [/^coordinate '([^']*)': section '([^']*)' is not declared$/, (m) => `Koordinate ${q(m[1])}: Abschnitt ${q(m[2])} ist nicht angelegt.`],
  [/^(reporting_point|work_center) storage_point_ref id '([^']*)' collides with a compiled storage_point id$/, (m) => `${thing(m[1])} ${q(m[2])}: Sein Lagerplatz (storage_point_ref) hat dieselbe ID wie ein erzeugter Lagerplatz.`],
  [/^duplicate warehouse import path$/, () => "Ein Import der Halle ist doppelt angegeben."],
  [/^extension import missing: (.+)$/, (m) => `Die Erweiterungsdatei ${m[1]} fehlt.`],
  [/^multiple imports named '([^']*)' are ambiguous$/, (m) => `Mehrere Importe heißen ${q(m[1])}, das ist mehrdeutig.`],
  [/^target\.facility '([^']*)' does not match parent facility '([^']*)'$/, (m) => `target.facility ${q(m[1])} passt nicht zum Standort ${q(m[2])}.`],
  [/^target\.tenant '([^']*)' does not match parent company '([^']*)'$/, (m) => `target.tenant ${q(m[1])} passt nicht zur Firma ${q(m[2])}.`],
  [/^Topology (\S+): ([a-z_]+) (\S+): load unit type '([^']*)' is neither in MasterData's global catalog nor in the company's load_unit_types\.yaml$/, (m) => `Topologie ${m[1]}, ${thing(m[2])} ${m[3]}: Ladungsträger ${q(m[4])} steht weder im globalen Katalog der Stammdaten noch bei den Ladungsträgern der Firma.`],

  [/^and '([^']*)' have the same applies_to scope \((.+)\) - ambiguous$/, (m) => `Gilt für denselben Bereich (${m[2]}) wie ${q(m[1])}. Die Regeln sind nicht eindeutig.`],
  [/^uom_hierarchy\[(\d+)\] \(([^)]*)\): goods weight ([\d.]+) kg \((.+)\) exceeds load_unit_type '([^']*)' max_weight (-?[\d.]+) kg$/, (m) => `Verpackungsstufe ${Number(m[1]) + 1} (${m[2]}): Das Warengewicht von ${m[3]} kg (${m[4]}) überschreitet max_weight ${m[6]} kg von Ladungsträger ${q(m[5])}.`],
  [/^duplicate ([a-z_]+) ids: \[(.*)\]$/, (m) => `${thing(m[1])} ${names(m[2])} gibt es mehrfach.`],
  [/^R2 shelf-life floor (-?\d+) days is above item '([^']*)' receipt minimum (-?\d+) days; accepted stock may never ship$/, (m) => `Regel R2: Die Mindestrestlaufzeit von ${m[1]} Tagen liegt über dem Wareneingangs-Minimum von Artikel ${q(m[2])} (${m[3]} Tage). Angenommener Bestand wird womöglich nie ausgeliefert.`],
  [/^Topology compile failed for (\S+?):?$/, (m) => `Die Topologie-Halle ${m[1]} lässt sich nicht kompilieren.`],
  [/^duplicate storage_point id generated: '([^']*)'$/, (m) => `Lagerplatz ${q(m[1])} wird doppelt erzeugt.`],
  [/^'([^']*)' is not under (customers\/[^/]+\/)$/, (m) => `${q(m[1])} liegt nicht im Ordner des Kunden (${m[2]}).`],
  [/^not found in ([A-Za-z]+-as-Code): (.+)$/, (m) => `${m[2]} gibt es ${inRepo(m[1])} nicht.`],

  [/^no owner set and category has no default_attributes\.owner, but company\.yaml declares owners$/, () => "Kein Eigentümer angegeben, und die Kategorie hat keinen Standard (default_attributes.owner). Die Firma führt aber Eigentümer, also braucht jeder Artikel einen."],
  [/^R12 allow_substitution is true, but no item of the company has a substitute_item_id$/, () => "Regel R12: allow_substitution ist eingeschaltet, aber kein Artikel der Firma hat einen Ersatzartikel (substitute_item_id)."],
  [/^execution '([^']*)' contradicts the endpoints \(from controller=(\S+), to controller=(\S+) -> implies '([^']*)'\)\. .*$/, (m) => `Ausführung ${q(m[1])} passt nicht zu Start und Ziel (Steuerung ${m[2] === "None" ? "keine" : q(m[2])} → ${m[3] === "None" ? "keine" : q(m[3])}, das bedeutet ${q(m[4])}). „automated“ verlangt, dass beide unter derselben Steuerung liegen.`],

  [/^must live in (\S+)$/, (m) => `muss in der Datei ${m[1]} stehen.`],
  [/^is used by another manifest$/, () => "wird schon von einem anderen Standort-Manifest verwendet."],
  [/^OrderOrchestration company not found: (.+)$/, (m) => `Die Firma fehlt in OrderOrchestration: ${m[1]}.`],
  [/^lists '([^']*)' twice$/, (m) => `nennt ${q(m[1])} doppelt.`],
  [/^([a-z_ ]+?) '([^']*)' not found in building\(s\) (.+)$/, (m) => `${val(m[1], m[2])} ist in Halle ${m[3]} nicht vorhanden.`],
  [/^'([^']*)' is not a Topology storage_technology$/, (m) => `${q(m[1])} ist keine Lagertechnik der Topologie.`],
  [/^([a-z_ ]+?) '([^']*)' not in the Topology building$/, (m) => `${val(m[1], m[2])} ist in dieser Halle der Topologie nicht vorhanden.`],
  [/^([a-z_ ]+?) '([^']*)' not in MasterData$/, (m) => `${val(m[1], m[2])} ist in den Stammdaten nicht vorhanden.`],
  [/^FIXED_BIN_FIRST but the building does not import strategies\/fixed_bin_assignments\.yaml$/, () => "FIXED_BIN_FIRST ist eingestellt, aber die Halle importiert keine Festplätze (strategies/fixed_bin_assignments.yaml)."],
  [/^zone '([^']*)' is reserved for owners (.+) but the rule has no applies_to\.owner$/, (m) => `Zone ${q(m[1])} ist für die Eigentümer ${m[2]} reserviert, die Regel hat aber kein applies_to.owner.`],
  [/^zone '([^']*)' is reserved for owners (.+), not '([^']*)'$/, (m) => `Zone ${q(m[1])} ist für die Eigentümer ${m[2]} reserviert, nicht für ${q(m[3])}.`],
  [/^tracking\.expiry\.min_remaining_at_receipt_days \((-?\d+)\) exceeds total_shelf_life_days \((-?\d+)\) - no delivery could ever be accepted$/, (m) => `Die Mindestrestlaufzeit beim Wareneingang (${m[1]} Tage) ist länger als die Haltbarkeit (${m[2]} Tage). Keine Lieferung könnte je angenommen werden.`],
  [/^([\w.]+) \((-?[\d.]+)\) exceeds ([\w.]+) \((-?[\d.]+)\)$/, (m) => `${m[1]} (${m[2]}) ist größer als ${m[3]} (${m[4]}).`],
  [/^storage_point already fixed to item '([^']*)'$/, (m) => `Der Lagerplatz ist schon Artikel ${q(m[1])} fest zugeordnet.`],
  [/^planned_qty \((-?[\d.]+)\) is outside min_qty\.\.max_qty \((\S+)\)$/, (m) => `planned_qty (${m[1]}) liegt außerhalb von min_qty..max_qty (${m[2]}).`],
  [/^zone '([^']*)' already covered by steps\[(\d+)\] for the same load unit types and constraints - this step is unreachable$/, (m) => `Zone ${q(m[1])} deckt schon Schritt ${Number(m[2]) + 1} mit denselben Ladungsträgern und Bedingungen ab. Dieser Schritt wird nie erreicht.`],
  [/^File is empty or invalid\.$/, () => "Die Datei ist leer oder kein gültiges YAML."],
  [/^unrecognized root key \(expected one of (.+)\)\.$/, (m) => `Unbekannter Abschnitt ganz oben in der Datei. Erwartet: ${names(m[1])}.`],
  [/^load_unit_type '([^']*)' already exists in elements\/load_unit_types\.yaml - .*$/, (m) => `Ladungsträger ${q(m[1])} gibt es schon im globalen Katalog. Den globalen verwenden oder eine andere ID wählen.`],
  [/^no default_uom set and category has no default_attributes\.default_uom to inherit$/, () => "Keine Mengeneinheit (default_uom) angegeben, und die Kategorie hat keinen Standard zum Erben."],
  [/^serial capture '([^']*)' needs a packaging uom_hierarchy in structure\/packaging\.yaml.*$/, (m) => `Seriennummernerfassung ${q(m[1])} braucht eine Verpackungshierarchie in den Verpackungen (Seriennummern gelten je Basiseinheit).`],
  [/^(?:default_attributes\.)?owner '([^']*)' not declared in company\.yaml owners$/, (m) => `Eigentümer ${q(m[1])} ist bei der Firma nicht angelegt.`],
  [/^owner '([^']*)' set but company\.yaml declares no owners$/, (m) => `Eigentümer ${q(m[1])} ist gesetzt, aber die Firma führt keine Eigentümer.`],
  [/^GTIN '([^']*)' has a wrong check digit$/, (m) => `GTIN ${q(m[1])} hat eine falsche Prüfziffer.`],
  [/^more than one barcode marked primary$/, () => "Mehr als ein Barcode ist als primär markiert."],
  [/^action\.supersedes_parent is true but structure\/status\.yaml has no '([^']*)' status$/, (m) => `supersedes_parent ist gesetzt, aber es gibt keinen Status ${q(m[1])}.`],
  [/^has none of storage_point_generator \/ layout_variants \/ storage_points - skipped.*$/, () => "Hat weder storage_point_generator noch layout_variants noch storage_points und wird übersprungen (vermutlich anderswo von Hand angelegt)."],
  [/^temperature min must not exceed max$/, () => "Die Mindesttemperatur darf nicht über der Höchsttemperatur liegen."],
  [/^automation_level '([^']*)' requires movement_policy '([^']*)' to be stated$/, (m) => `Automatisierungsgrad ${q(m[1])} verlangt, dass movement_policy ${q(m[2])} angegeben ist.`],
  [/^automation_level '([^']*)' implies movement_policy '([^']*)', found '([^']*)'$/, (m) => `Automatisierungsgrad ${q(m[1])} bedeutet movement_policy ${q(m[2])}, angegeben ist ${q(m[3])}.`],
  [/^controller requires an automated automation_level, but '([^']*)' is not automated$/, (m) => `Eine Steuerung setzt einen automatisierten Automatisierungsgrad voraus, ${q(m[1])} ist es nicht.`],
  [/^unknown template catalog '([^']*)'$/, (m) => `Unbekannter Vorlagenkatalog ${q(m[1])}.`],
  [/^section '([^']*)' not found in storage_type '([^']*)'$/, (m) => `Abschnitt ${q(m[1])} ist im Lagertyp ${q(m[2])} nicht vorhanden.`],
  [/^(?:[a-z_]+ )?([a-z_.]+) '([^']*)' not found in storage_type '([^']*)'$/, (m) => `${val(m[1], m[2])} ist im Lagertyp ${q(m[3])} nicht vorhanden.`],
  [/^topology id '([^']*)' is used by both (.+) and (.+); .*$/, (m) => `Die ID ${q(m[1])} verwenden ${m[2]} und ${m[3]} zugleich. Verweise in Fahrwegen und Förderern wären mehrdeutig.`],
  [/^invalid coordinate_pattern: (.+)$/, (m) => `Ungültiges coordinate_pattern: ${m[1]}`],
  [/^selector coordinate '([^']*)' does not exist$/, (m) => `Die Auswahl nennt Koordinate ${q(m[1])}, die es nicht gibt.`],
  [/^selector axes (.+) are not available for this point definition$/, (m) => `Die Auswahlachsen ${m[1]} gibt es bei dieser Platzdefinition nicht.`],
  [/^selector (\S+)\.from must not exceed to$/, (m) => `Auswahl ${m[1]}: „from“ darf nicht größer als „to“ sein.`],
  [/^load_limits\.positions_per_bay is required with storage_point_generator$/, () => "load_limits.positions_per_bay ist bei storage_point_generator Pflicht."],
  [/^load_limits\.positions_per_bay (-?\d+) does not divide storage_point_generator\.stacks (-?\d+)$/, (m) => `load_limits.positions_per_bay ${m[1]} teilt storage_point_generator.stacks ${m[2]} nicht ohne Rest.`],
  [/^load_limits\.positions_per_bay is not used with layout_variants.*$/, () => "load_limits.positions_per_bay gilt nicht bei layout_variants, dort bestimmt das Fach des layout_grid."],
  [/^load_limits exception for aisle (-?\d+) bay (-?\d+) listed twice$/, (m) => `Die load_limits-Ausnahme für Gasse ${m[1]}, Fach ${m[2]} steht doppelt da.`],
  [/^aisle (-?\d+) bay (-?\d+): shelf_max_weight ([\d.]+) kg exceeds bay_max_weight ([\d.]+) kg$/, (m) => `Gasse ${m[1]}, Fach ${m[2]}: shelf_max_weight ${m[3]} kg ist größer als bay_max_weight ${m[4]} kg.`],
  [/^max_weight ([\d.]+) kg exceeds the (\w+) limit ([\d.]+) kg$/, (m) => `max_weight ${m[1]} kg ist größer als die Grenze für ${m[2]} (${m[3]} kg).`],
  [/^route_aisle\/route_position need a routing block on the storage_type$/, () => "route_aisle und route_position brauchen einen routing-Block am Lagertyp."],
  [/^routing is set, so (\S+) must be stated$/, (m) => `routing ist gesetzt, deshalb muss ${m[1]} angegeben sein.`],
  [/^routing aisle (-?\d+) listed twice$/, (m) => `Fahrgasse ${m[1]} steht doppelt da.`],
  [/^duplicate extension import path$/, () => "Eine Erweiterungsdatei ist doppelt importiert."],
  [/^extension records not checked, building does not compile \((.+)\)$/, (m) => `Erweiterungseinträge nicht geprüft, weil sich die Halle nicht kompilieren lässt (${m[1]}).`],
  [/^duplicate ([a-z_. ]+?) '([^']*)'(?: in facility)?$/, (m) => `${q(m[1])} ${q(m[2])} kommt doppelt vor.`],

  [/^section '([^']*)' is not declared$/, (m) => `Abschnitt ${q(m[1])} ist nicht angelegt.`],
  [/^layout_grid\.levels > (\d+) needs \{level\} in coordinate_pattern$/, (m) => `Bei mehr als ${m[1]} Ebene braucht coordinate_pattern den Platzhalter {level}.`],

  // Generic references, last: "<field> 'x' not found [in <file or list>]"
  [/^(?:[a-z_]+ )?([a-z_.]+) '([^']*)' not found in (?:the )?((?:structure|strategies)\/[a-z_]+\.yaml|[a-z_]+\.yaml(?: [a-z_]+)?|statuses|reporting_points|controller_definitions|topology endpoints|[a-z_]+(?:\/[a-z_]+)+)$/, (m) => `${val(m[1], m[2])} ist ${inFile(m[3])} nicht vorhanden.`],
  [/^'([^']*)' not found in statuses$/, (m) => `Status ${q(m[1])} gibt es nicht.`],
  [/^(?:[a-z_]+ )?([a-z_.]+) '([^']*)' not found$/, (m) => `${val(m[1], m[2])} ist nicht vorhanden.`],
];

// English: the tools' own wording, with location and subject in plain English.
const REPO_LABEL_EN: Record<string, string> = {
  "Topology-as-Code": "Topology",
  "Allocation-as-Code": "Allocation",
  "OrderOrchestration-as-Code": "Orders",
  "MasterData-as-Code": "Master data",
  "Warehouse-as-Code": "Sites",
};
const FILE_LABEL_EN: Record<string, string> = {
  "company.yaml": "Company", "facility.yaml": "Site", "warehouse.yaml": "Hall", "storage.yaml": "Storage structure",
  "lanes.yaml": "Connections", "wcs.yaml": "Controllers and reporting points", "scan_codes.yaml": "Scan codes",
  "movement_rules.yaml": "Movement rules", "replenishment.yaml": "Replenishment", "allocation.yaml": "Hall allocation",
  "fields.yaml": "Fields", "search_rules.yaml": "Search rules", "putaway_rules.yaml": "Putaway rules",
  "fixed_bin_assignments.yaml": "Fixed bins", "area_assignments.yaml": "Area assignments", "owner_zones.yaml": "Owner zones",
  "category.yaml": "Category", "items.yaml": "Items", "packaging.yaml": "Packaging", "sourcing.yaml": "Sourcing",
  "lifecycle.yaml": "Lifecycle", "load_unit_types.yaml": "Load unit types", "channel.yaml": "Channel",
  "order_type.yaml": "Order type", "status.yaml": "Statuses", "split_rules.yaml": "Split rules",
  "workflow_triggers.yaml": "Workflow triggers", "completion_rules.yaml": "Completion rules", "shortage_policy.yaml": "Shortage policy",
};
const ENTITY_EN_OVERRIDE: Record<string, string> = {
  controller_definitions: "Controller", item_id: "Item", substitute_item_id: "Substitute item", replenishment_strategies: "Replenishment strategy",
  warehouse: "Hall", building: "Hall", facility: "Site", site: "Site", "site id": "Site id", statuses: "Status", status: "Status",
  equipment: "Equipment", packaging: "Packaging", sourcing: "Sourcing", lifecycle: "Lifecycle",
};
/** An entity word in English: storage_types → Storage type. */
function entityEn(key: string): string {
  if (ENTITY_EN_OVERRIDE[key]) return ENTITY_EN_OVERRIDE[key];
  const words = key.replace(/_/g, " ").replace(/ies$/, "y").replace(/s$/, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The language explain() is working in; set for the duration of one call. */
let mode: Lang = "de";
const en = () => mode === "en";
/** The name of an entity word in the current language, if it names one. */
const entityName = (key: string): string | undefined => (ENTITY[key] ? (en() ? entityEn(key) : ENTITY[key]) : undefined);

const FOLDER_EN: Record<string, (v: string) => string> = {
  facilities: (v) => v.replace(/^facility_/, "").toUpperCase(),
  buildings: (v) => v.replace(/^hall_/, "Hall "),
  categories: (v) => `Category ${v}`,
  channels: (v) => `Channel ${v}`,
  order_types: (v) => `Order type ${v}`,
  examples: (v) => `Example ${v}`,
};

const FOLDER: Record<string, (v: string) => string> = {
  facilities: (v) => v.replace(/^facility_/, "").toUpperCase(),
  buildings: (v) => v.replace(/^hall_/, "Halle "),
  categories: (v) => `Kategorie ${v}`,
  channels: (v) => `Kanal ${v}`,
  order_types: (v) => `Auftragsart ${v}`,
  examples: (v) => `Beispiel ${v}`,
};

/** A file path as a place people know: area, customer, site, hall and what the file holds. */
export function describePath(path: string, lang: Lang = mode): string {
  const english = lang === "en";
  const repoLabel = english ? REPO_LABEL_EN : REPO_LABEL;
  const fileLabel = english ? FILE_LABEL_EN : FILE_LABEL;
  const folder = english ? FOLDER_EN : FOLDER;
  const parts = path.split("/").filter(Boolean);
  const bits: string[] = [];
  if (repoLabel[parts[0]]) bits.push(repoLabel[parts.shift()!]);
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if ((part === "customers" || part === "sites") && parts[i + 1] && i + 2 < parts.length) {
      bits.push(parts[++i]);
    } else if (folder[part] && parts[i + 1] && i + 1 < parts.length - (/\.\w+$/.test(parts[parts.length - 1]) ? 1 : 0)) {
      bits.push(folder[part](parts[++i]));
    }
  }
  const file = parts[parts.length - 1] ?? "";
  if (/\.(ya?ml|json)$/.test(file)) {
    if (parts[0] === "sites") bits.push(`${english ? "Site" : "Standort"} ${file.replace(/\.ya?ml$/, "").toUpperCase()}`);
    else if (parts.includes("extensions")) bits.push(`${english ? "WMS extension" : "WMS-Erweiterung"} ${file}`);
    else bits.push(fileLabel[file] ?? file);
  } else if (folder[parts[parts.length - 2]]) {
    // a folder (e.g. Repo/examples/x) was handled above
  } else if (file) bits.push(file);
  return bits.join(" · ");
}

const FIELD: Record<string, string> = { steps: "Schritt", positions: "Position", transitions: "Übergang", order_types: "Auftragsart" };

/** "steps[0].zone" → "Schritt 1 › zone": list positions counted from 1, as people count. */
function fieldPath(path: string): string {
  if (en()) return path.replace(/\s*->\s*/g, " › ").replace(/\[(\d+)\]/g, "[$1]");
  return path
    .replace(/\b([a-z_]+)(?=\[\d+\]|\s*->\s*\d)/g, (w) => FIELD[w] ?? ENTITY[w] ?? w)
    .replace(/\[(\d+)\]/g, (_, n) => ` ${Number(n) + 1}`)
    .replace(/\s*->\s*(\d+)/g, (_, n) => ` ${Number(n) + 1}`)
    .replace(/\s*(?:->|\.)\s*/g, " › ")
    .split(" › ")
    .map((part) => SEGMENT[part] ?? part)
    .join(" › ");
}
const SEGMENT: Record<string, string> = { from: "Start", to: "Ziel", exclude_to: "ausgeschlossenes Ziel", when: "Bedingung", action: "Aktion" };

const PATH = /^((?:[\w.-]+\/)*[\w.-]+\.(?:ya?ml|json)|[\w-]+-as-Code(?:\/[\w.-]+)+):\s+([\s\S]*)$/;

/**
 * A finding with location and subject. In German the message becomes a
 * German sentence; in English it stays in the tool's own words. The full
 * original line is kept in `original`.
 */
export function explain(raw: string, lang: Lang = getLang()): Finding {
  const previous = mode;
  mode = lang;
  try {
    return explainIn(raw);
  } finally {
    mode = previous;
  }
}

function explainIn(raw: string): Finding {
  const original = raw.trim();
  let rest = original;
  const location: string[] = [];
  let subject = "";
  const where: string[] = [];

  // Leading file paths: the file the finding is in, sometimes followed by a file it names.
  for (let m = PATH.exec(rest); m; m = PATH.exec(rest)) {
    location.push(describePath(m[1]));
    rest = m[2];
  }
  const inner = /^([\w-]+\.ya?ml) ([\s\S]*)$/.exec(rest);
  if (inner) {
    location.push((en() ? FILE_LABEL_EN : FILE_LABEL)[inner[1]] ?? inner[1]);
    rest = inner[2];
  }
  // An example order: "order [path] ...", "positions[0] [path] ..."
  const order = /^(order|positions\[\d+\])\s+(\[[\s\S]*)$/.exec(rest);
  if (order) {
    where.push(order[1] === "order" ? (en() ? "order header" : "Auftragskopf") : fieldPath(order[1]));
    rest = order[2];
  }
  // A schema path: "[site -> allocation] ..."
  const schemaPath = /^\[([^\]]+)\]\s+([\s\S]*)$/.exec(rest);
  if (schemaPath) {
    where.push(fieldPath(schemaPath[1]));
    rest = schemaPath[2];
  }
  // The subject: "door 'DOOR_01': ...", "order_types[2] ...", "area_assignments[0] (ITEM_003 @ ...): ..."
  const named = /^([a-z_]+(?: [a-z_]+)?) '([^']+)'(\.[\w.]+)?(?::\s+|\s+(?=[a-z_]+\[)|\s+(?=\S))([\s\S]*)$/.exec(rest);
  const numbered = /^([a-z_]+) #(\d+):\s+([\s\S]*)$/.exec(rest);
  const indexed = /^([a-z_]+)\[(\d+)\](?:\s*\(([^)]*)\))?([.\w[\]]*)(?::\s+|\s+)([\s\S]*)$/.exec(rest);
  if (named && ENTITY[named[1]]) {
    subject = named[2] === "?" ? entityName(named[1])! : `${entityName(named[1])} ${named[2]}`;
    if (named[3]) where.push(fieldPath(named[3].slice(1)));
    rest = named[4];
  } else if (numbered && ENTITY[numbered[1]]) {
    subject = `${entityName(numbered[1])} ${en() ? "#" : "Nr. "}${numbered[2]}`;
    rest = numbered[3];
  } else if (indexed && ENTITY[indexed[1]]) {
    subject = `${entityName(indexed[1])} ${en() ? "#" : "Nr. "}${Number(indexed[2]) + 1}${indexed[3] ? ` (${indexed[3]})` : ""}`;
    if (indexed[4]) where.push(fieldPath(indexed[4].replace(/^\./, "")));
    rest = indexed[5];
  }
  if (en()) return { location: location.join(" · "), subject, text: where.length ? `${where.join(", ")}: ${rest}` : rest, original, translated: true };
  // A field inside the subject: "steps[0]: ...", "zone.type ..."
  const field = /^([a-z_]+(?:\[\d+\])?(?:\.[a-z_]+(?:\[\d+\])?)*):\s+([\s\S]*)$/.exec(rest);
  if (field && (/[[.]/.test(field[1]) || ENTITY[field[1]])) {
    where.push(ENTITY[field[1]] ?? fieldPath(field[1]));
    rest = field[2];
  }
  const exception = /^exception at '([^']*)':\s+([\s\S]*)$/.exec(rest);
  if (exception) {
    where.push(`Ausnahme bei ${q(exception[1])}`);
    rest = exception[2];
  }
  // Nested context: "staging_section 'X': ...", "section 'SEC': ..."
  for (let nested = /^([a-z_]+) '([^']*)':\s+([\s\S]+)$/.exec(rest); nested; nested = /^([a-z_]+) '([^']*)':\s+([\s\S]+)$/.exec(rest)) {
    where.push(val(nested[1], nested[2]).replace(/^Der Wert (.+) in (.+)$/, "$2 $1"));
    rest = nested[3];
  }

  let text = rest;
  let translated = false;
  for (const [pattern, render] of RULES) {
    const m = rest.match(pattern);
    if (m) {
      text = render(m);
      translated = true;
      break;
    }
  }
  if (where.length) text = `${where.join(", ")}: ${text}`;
  return { location: location.join(" · "), subject, text, original, translated };
}
