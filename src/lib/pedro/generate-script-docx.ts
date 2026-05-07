import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  LevelFormat,
  PageBreak,
  ShadingType,
} from "docx";

export interface ScriptVideo {
  title: string; // e.g. "Video 1 - Urgentie"
  hooks: string[]; // array of hook texts
  body: string;
  cta: string;
}

// Rocket Leads logo as base64 PNG (small purple rocket icon)
// We'll use a text-based header instead for reliability
const PURPLE = "8967f3";
const DARK = "222427";
const WHITE = "ffffff";

function headerParagraph(text: string) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [
      new TextRun({
        text,
        font: "Inter",
        size: 18, // 9pt
        color: PURPLE,
        bold: true,
      }),
    ],
  });
}

function guidelineItem(label: string, text: string) {
  return new Paragraph({
    numbering: { reference: "guidelines", level: 0 },
    spacing: { after: 40, before: 0 },
    children: [
      new TextRun({
        text: `${label}: `,
        font: "Inter",
        bold: true,
        color: PURPLE,
        size: 22,
      }),
      new TextRun({
        text,
        font: "Inter",
        color: DARK,
        size: 22,
      }),
    ],
  });
}

function buildVideoSection(video: ScriptVideo): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // Video title
  paragraphs.push(
    new Paragraph({
      spacing: { before: 360, after: 160 },
      children: [
        new TextRun({
          text: video.title,
          font: "Inter",
          bold: true,
          size: 38,
          color: DARK,
        }),
      ],
    })
  );

  // Hooks
  for (let i = 0; i < video.hooks.length; i++) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 240, after: 240 },
        children: [
          new TextRun({
            text: `Hook ${i + 1}: `,
            font: "Inter",
            bold: true,
            color: PURPLE,
            size: 22,
          }),
          new TextRun({
            text: video.hooks[i],
            font: "Inter",
            size: 22,
            color: DARK,
          }),
        ],
      })
    );
  }

  // Body
  paragraphs.push(
    new Paragraph({
      spacing: { before: 240, after: 240 },
      children: [
        new TextRun({
          text: "Body: ",
          font: "Inter",
          bold: true,
          color: PURPLE,
          size: 22,
        }),
        new TextRun({
          text: video.body,
          font: "Inter",
          size: 22,
          color: DARK,
        }),
      ],
    })
  );

  // CTA
  paragraphs.push(
    new Paragraph({
      spacing: { before: 240, after: 240 },
      children: [
        new TextRun({
          text: "CTA: ",
          font: "Inter",
          bold: true,
          color: PURPLE,
          size: 22,
        }),
        new TextRun({
          text: video.cta,
          font: "Inter",
          size: 22,
          color: DARK,
        }),
      ],
    })
  );

  return paragraphs;
}

export async function generateScriptDocx(
  videos: ScriptVideo[],
  clientName: string
): Promise<Blob> {
  const guidelines = [
    [
      "Informeren",
      "Het belangrijkste is dat de video pakkend is en mensen aanspoort om te klikken. Informeren hoeft nog niet; daarvoor sturen we ze door naar een landingspagina met meer informatie.",
    ],
    [
      "Afmetingen",
      "Neem je video staand op. Dit betekent een formaat van 9:16, of nog beter, 4:5. Stel de afmetingen in bij de camera van je telefoon. Dit is cruciaal voor een goed eindresultaat!",
    ],
    [
      "Video intonatie",
      "Zorg ervoor dat je enthousiast, upbeat en blij overkomt - dit werkt het beste voor een advertentie.",
    ],
    [
      "Snelheid",
      "Neem de tijd tussen zinnen. Pauzes kunnen we eruit knippen.",
    ],
    [
      "Belichting",
      "Goede belichting is essentieel. Gebruik bij voorkeur natuurlijk licht vanuit een groot raam of film buiten. Zet HDR uit in je camera-instellingen.",
    ],
    [
      "Opname",
      "Graag 1-3 seconden extra toevoegen aan het begin en einde van alle clips, waarin je ook nog in de camera kijkt.",
    ],
    [
      "Harde geluiden",
      "Zet alle airco's, ventilatoren en andere harde geluiden uit tijdens het filmen.",
    ],
    [
      "Filters",
      "Voeg geen filters of kleurgradatie toe aan de inhoud.",
    ],
    [
      "Logo's",
      "Vermijd het dragen van kleding met logo's. Houd je achtergrond schoon en/of esthetisch.",
    ],
    [
      "Benaming video's",
      "Als je takes apart opneemt, geef ze DUIDELIJKE namen in de DRIVE. Bijvoorbeeld, Hook 1 noem je 'Hook 1' en plaats je in de map \"Video 1\".",
    ],
  ];

  // Page 1: Guidelines
  const page1Children: Paragraph[] = [
    // Intro text
    new Paragraph({
      spacing: { before: 240, after: 240 },
      children: [
        new TextRun({
          text: `Scripts - ${clientName}`,
          font: "Inter",
          bold: true,
          size: 48,
          color: DARK,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: "De scripts staan op pagina 2, maar hier heb je alvast wat Guidelines.",
          font: "Inter",
          size: 22,
          color: DARK,
        }),
      ],
    }),
    // Purple warning box
    new Paragraph({
      spacing: { before: 240, after: 240 },
      children: [
        new TextRun({
          text: "Let op! Lees deze richtlijnen goed door voordat je begint met opnemen.",
          font: "Inter",
          bold: true,
          size: 26,
          color: WHITE,
          shading: { type: ShadingType.CLEAR, fill: PURPLE },
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: "Zo kunnen wij je video's optimaal editten, en kunnen we zo snel mogelijk live.",
          font: "Inter",
          size: 22,
          color: DARK,
        }),
      ],
    }),
    // Richtlijnen heading
    new Paragraph({
      spacing: { before: 240, after: 240 },
      children: [
        new TextRun({
          text: "Richtlijnen",
          font: "Inter",
          bold: true,
          size: 38,
          color: DARK,
        }),
        new TextRun({ text: ":", font: "Inter", size: 22, color: DARK }),
      ],
    }),
    // Guidelines list
    ...guidelines.map(([label, text]) => guidelineItem(label, text)),
  ];

  // Page 2+: Video scripts
  const page2Children: Paragraph[] = [
    new Paragraph({ children: [new PageBreak()] }),
  ];
  for (const video of videos) {
    page2Children.push(...buildVideoSection(video));
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "guidelines",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
                run: { font: "Inter", color: PURPLE, bold: true },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: "Inter", size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [...page1Children, ...page2Children],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// Parse the raw script text from Claude into ScriptVideo objects
export function parseScriptText(raw: string): ScriptVideo[] {
  const videos: ScriptVideo[] = [];
  // Split by "VIDEO 1" / "VIDEO 2" or "Video 1:" / "Video 2:" patterns
  const videoBlocks = raw.split(/(?=---\s*\n\s*VIDEO\s+\d|Video\s+\d\s*[:\u2014])/i).filter((b) => b.trim());

  for (const block of videoBlocks) {
    // Extract title
    const titleMatch = block.match(/(?:VIDEO|Video)\s+(\d+)\s*[\u2014:\-]+\s*(.+?)(?:\n|$)/i);
    if (!titleMatch) continue;

    const title = `Video ${titleMatch[1]}: ${titleMatch[2].trim().replace(/^[\s\-]+/, "")}`;

    // Extract hooks
    const hooks: string[] = [];
    const hookMatches = Array.from(block.matchAll(/Hook\s+\d+\s*:\s*"?([^"\n]+)"?/gi));
    for (const m of hookMatches) {
      hooks.push(m[1].trim().replace(/^"|"$/g, ""));
    }

    // Extract body
    const bodyMatch = block.match(/Body\s*:\s*\n?([\s\S]*?)(?=\n\s*CTA\s*:|$)/i);
    const body = bodyMatch
      ? bodyMatch[1]
          .replace(/^\[|\]$/g, "")
          .trim()
      : "";

    // Extract CTA
    const ctaMatch = block.match(/CTA\s*:\s*\n?([\s\S]*?)(?=\n\s*---|\n\s*VIDEO\s+\d|$)/i);
    const cta = ctaMatch
      ? ctaMatch[1]
          .replace(/^\[|\]$/g, "")
          .trim()
      : "";

    if (hooks.length > 0 || body) {
      videos.push({ title, hooks, body, cta });
    }
  }

  return videos;
}
