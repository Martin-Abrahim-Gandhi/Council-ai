import { activity, conversations, navItems } from "@/lib/council-data";

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    chat: "M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v6a3.5 3.5 0 0 1-3.5 3.5H11l-4.5 3v-3.2A3.5 3.5 0 0 1 4 11.5z",
    feed: "M5 5h14M5 10h14M5 15h9M5 20h7",
    book: "M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5zM5 4.5v17",
    plus: "M12 5v14M5 12h14",
    settings: "M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 0 0 12 8.5zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 1.42-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-2v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.42-1.42.06-.06A1.7 1.7 0 0 0 9.4 15a1.7 1.7 0 0 0-1.56-1.03H7v-2h.84A1.7 1.7 0 0 0 9.4 11a1.7 1.7 0 0 0-.34-1.88L9 9.06l1.42-1.42.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 13.4 6.5V6h2v.5A1.7 1.7 0 0 0 16.43 8a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.42 1.42-.06.06A1.7 1.7 0 0 0 19.4 11a1.7 1.7 0 0 0 1.56 1.03H22v2h-1.04A1.7 1.7 0 0 0 19.4 15z",
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-name">COUNCIL</div>
            <div className="brand-subtitle">Thought. Reason. Action.</div>
          </div>
        </div>

        <nav className="nav" aria-label="Primary navigation">
          {navItems.map((item, index) => (
            <a key={item.label} href={item.href} className={index === 0 ? "nav-item active" : "nav-item"}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-dot" />
          <span>System ready</span>
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">COUNCIL / OVERVIEW</p>
            <h1>Dashboard</h1>
          </div>
          <div className="header-status">
            <span className="pulse" />
            Human approval required
          </div>
        </header>

        <div className="content">
          <section className="hero">
            <div>
              <span className="section-kicker">COUNCIL ACTIVITY</span>
              <h2>Observe first. Reason carefully. Act deliberately.</h2>
              <p>
                Council is currently configured as a read-and-draft system.
                External actions remain behind human approval.
              </p>
            </div>
            <div className="hero-orbit" aria-hidden="true">
              <span>R</span><span>E</span><span>A</span><span>S</span><span>O</span><span>N</span>
            </div>
          </section>

          <section className="activity-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">LIVE LOG</span>
                <h3>What Council is doing</h3>
              </div>
              <span className="muted">Stage 1</span>
            </div>
            <div className="activity-list">
              {activity.map((item) => (
                <div className="activity-row" key={item.id}>
                  <span className={item.state === "active" ? "activity-dot active" : "activity-dot"} />
                  <div className="activity-copy">
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <time>{item.time}</time>
                </div>
              ))}
            </div>
          </section>

          <section className="conversation-section">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">RECENT</span>
                <h3>Recent Conversations</h3>
              </div>
              <a href="#conversations" className="text-link">View all →</a>
            </div>

            <div className="conversation-grid">
              {conversations.map((conversation) => (
                <article className="conversation-card" key={conversation.id}>
                  <div className="card-topline">
                    <span className="conversation-type">{conversation.type}</span>
                    <span className="message-count">{conversation.messages} messages</span>
                  </div>
                  <h4>{conversation.title}</h4>
                  <p>{conversation.preview}</p>
                  <div className="card-footer">
                    <span>Last activity: {conversation.lastActivity}</span>
                    <span className="arrow">↗</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
