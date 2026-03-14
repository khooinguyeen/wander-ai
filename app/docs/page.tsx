export default function DocsPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "48px 20px",
        background: "linear-gradient(180deg, #f8f3eb 0%, #f0e6d7 100%)",
        color: "#16202a",
        fontFamily: "var(--font-sans)"
      }}
    >
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: 28,
          borderRadius: 28,
          background: "rgba(255, 252, 247, 0.92)",
          border: "1px solid rgba(22, 32, 42, 0.12)"
        }}
      >
        <p
          style={{
            margin: 0,
            color: "#0f766e",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontSize: 12
          }}
        >
          Scrape plan
        </p>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "3rem", lineHeight: 0.95, marginBottom: 18 }}>
          Build the Melbourne dataset in layers.
        </h1>
        <p style={{ color: "#58616b", lineHeight: 1.7 }}>
          Start with three areas only: Fitzroy or Collingwood, CBD or Carlton, and Southside or Elwood. First collect
          source URLs from TikTok, Instagram, and YouTube. Then extract place mentions, resolve them to coordinates,
          dedupe aggressively, and export one normalized `spots` file.
        </p>
        <p style={{ color: "#58616b", lineHeight: 1.7 }}>
          The markdown versions live in the repo at `docs/scraping-plan.md` and `docs/database-format.md`. This route
          exists so the MVP app has a clickable explanation without needing a markdown renderer dependency.
        </p>
      </div>
    </main>
  );
}
