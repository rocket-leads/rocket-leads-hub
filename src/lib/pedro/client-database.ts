// ── Client Database: MD-based campaign storage ──

export interface ClientCampaign {
  number: number;
  date: string;
  angle: string;
  angleDescription: string;
  hooksAM: string;
  hooksExtra: string;
  scriptSummary: string;
  creativesQty: number;
  creativesFormats: string;
  manusPrompt: string;
  lpStijl: string;
  lpLengte: string;
  pixelId: string;
  webhookUrl: string;
  utmStr: string;
  adCopyA: string;
  adCopyB: string;
}

export interface ClientData {
  name: string;
  created: string;
  lastUpdate: string;
  website: string;
  sector: string;
  drive: string;
  primaryColor: string;
  secondaryColor: string;
  tone: string;
  visualStyle: string;
  brandbook: string;
  doelgroep: string;
  pijnpunten: string;
  aanbod: string;
  usps: string;
  campaigns: ClientCampaign[];
}

export function clientSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildClientMD(data: ClientData): string {
  const campaignBlocks = data.campaigns
    .map(
      (c) => `### Campagne ${c.number} -- ${c.date}
**Angle:** ${c.angle}
**Angle beschrijving:** ${c.angleDescription}

**Hooks (account manager):**
${c.hooksAM || "-"}

**Hooks (campaign manager):**
${c.hooksExtra || "-"}

**Video script samenvatting:**
${c.scriptSummary || "-"}

**Creatives:**
- Aantal: ${c.creativesQty}
- Formaten: ${c.creativesFormats}
- Manus prompt lengte: ${c.manusPrompt.length} tekens

**Landingspagina:**
- Stijl: ${c.lpStijl}
- Lengte: ${c.lpLengte}
- Pixel ID: ${c.pixelId || "-"}
- Webhook: ${c.webhookUrl || "-"}
- UTM: ${c.utmStr || "-"}

**Ad copy variant A:** ${c.adCopyA}
**Ad copy variant B:** ${c.adCopyB}

<details>
<summary>Manus prompt (klik om te openen)</summary>

${c.manusPrompt}

</details>`
    )
    .join("\n\n---\n\n");

  return `# ${data.name} -- Pedro Campaign Database
**Aangemaakt:** ${data.created}
**Laatste update:** ${data.lastUpdate}
**Website:** ${data.website || "-"}
**Sector:** ${data.sector || "-"}
**Drive:** ${data.drive || "-"}

---

## Branding
- **Primary color:** ${data.primaryColor || "-"}
- **Secondary color:** ${data.secondaryColor || "-"}
- **Tone:** ${data.tone || "-"}
- **Visuele stijl:** ${data.visualStyle || "-"}
- **Brandbook:** ${data.brandbook || "nee"}

---

## Doelgroep
${data.doelgroep || "-"}

## Pijnpunten
${data.pijnpunten || "-"}

## Aanbod
${data.aanbod || "-"}

## USP's
${data.usps || "-"}

---

## Campagnes

${campaignBlocks}
`;
}

export function parseClientMD(md: string): ClientData | null {
  try {
    const header = (key: string): string => {
      const m = md.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "i"));
      return m?.[1]?.trim() || "";
    };

    const section = (heading: string): string => {
      const re = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n---|\$)`, "i");
      const m = md.match(re);
      return m?.[1]?.trim() || "";
    };

    const brandingBlock = section("Branding");
    const brandField = (key: string): string => {
      const m = brandingBlock.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "i"));
      return m?.[1]?.trim() || "";
    };

    // Parse campaigns
    const campaignsBlock = section("Campagnes");
    const campaigns: ClientCampaign[] = [];
    const campMatches = Array.from(campaignsBlock.matchAll(/### Campagne (\d+) -- (.+)/g));

    for (let i = 0; i < campMatches.length; i++) {
      const start = campMatches[i].index!;
      const end = i + 1 < campMatches.length ? campMatches[i + 1].index! : campaignsBlock.length;
      const block = campaignsBlock.substring(start, end);

      const campField = (key: string): string => {
        const m = block.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "i"));
        return m?.[1]?.trim() || "";
      };
      const campListField = (key: string): string => {
        const m = block.match(new RegExp(`- ${key}:\\s*(.+)`, "i"));
        return m?.[1]?.trim() || "";
      };

      // Extract manus prompt from details block
      const detailsMatch = block.match(/<details>[\s\S]*?<summary>[\s\S]*?<\/summary>\s*([\s\S]*?)\s*<\/details>/);
      const manusPrompt = detailsMatch?.[1]?.trim() || "";

      // Extract hooks sections (multiline)
      const hooksAMMatch = block.match(/\*\*Hooks \(account manager\):\*\*\s*\n([\s\S]*?)(?=\n\*\*)/);
      const hooksExtraMatch = block.match(/\*\*Hooks \(campaign manager\):\*\*\s*\n([\s\S]*?)(?=\n\*\*)/);
      const scriptMatch = block.match(/\*\*Video script samenvatting:\*\*\s*\n([\s\S]*?)(?=\n\*\*)/);

      campaigns.push({
        number: parseInt(campMatches[i][1]),
        date: campMatches[i][2].trim(),
        angle: campField("Angle"),
        angleDescription: campField("Angle beschrijving"),
        hooksAM: hooksAMMatch?.[1]?.trim() || "",
        hooksExtra: hooksExtraMatch?.[1]?.trim() || "",
        scriptSummary: scriptMatch?.[1]?.trim() || "",
        creativesQty: parseInt(campListField("Aantal")) || 3,
        creativesFormats: campListField("Formaten"),
        manusPrompt,
        lpStijl: campListField("Stijl"),
        lpLengte: campListField("Lengte"),
        pixelId: campListField("Pixel ID"),
        webhookUrl: campListField("Webhook"),
        utmStr: campListField("UTM"),
        adCopyA: campField("Ad copy variant A"),
        adCopyB: campField("Ad copy variant B"),
      });
    }

    // Extract name from title
    const nameMatch = md.match(/^# (.+?) -- Pedro Campaign Database/m);
    const name = nameMatch?.[1]?.trim() || "";

    return {
      name,
      created: header("Aangemaakt"),
      lastUpdate: header("Laatste update"),
      website: header("Website"),
      sector: header("Sector"),
      drive: header("Drive"),
      primaryColor: brandField("Primary color"),
      secondaryColor: brandField("Secondary color"),
      tone: brandField("Tone"),
      visualStyle: brandField("Visuele stijl"),
      brandbook: brandField("Brandbook"),
      doelgroep: section("Doelgroep"),
      pijnpunten: section("Pijnpunten"),
      aanbod: section("Aanbod"),
      usps: section("USP's"),
      campaigns,
    };
  } catch {
    return null;
  }
}
