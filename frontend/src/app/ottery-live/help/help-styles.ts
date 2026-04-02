/**
 * Shared stylesheet for all help page components.
 * Import as:  styles: [HELP_STYLES]
 */
export const HELP_STYLES = `
  .page-title {
    font-size: 22px; font-weight: 700; color: var(--text-1);
    letter-spacing: -0.5px; margin-bottom: 4px; margin-top: 8px;
  }
  .page-tagline {
    font-size: 14px; color: var(--text-2); margin-bottom: 28px;
  }

  h2 {
    font-size: 17px; font-weight: 700; color: var(--text-1);
    margin: 32px 0 12px; display: flex; align-items: center; gap: 9px;
  }
  h2 mat-icon {
    font-size: 20px; width: 20px; height: 20px; color: var(--accent);
  }
  h3 {
    font-size: 14px; font-weight: 700; color: var(--text-1);
    margin: 20px 0 8px;
  }
  p {
    font-size: 13.5px; color: var(--text-2); line-height: 1.65; margin: 0 0 12px;
  }

  .card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px 20px; margin-bottom: 12px;
  }
  .card-title {
    font-size: 13px; font-weight: 700; color: var(--text-1); margin-bottom: 6px;
    display: flex; align-items: center; gap: 7px;
  }
  .card-title mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--accent); }
  .card p { margin: 0; }

  .steps { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
  .step { display: flex; gap: 12px; align-items: flex-start; }
  .step-num {
    width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent-dim); border: 1px solid var(--accent-border);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: var(--accent); margin-top: 2px;
  }
  .step-body { flex: 1; }
  .step-body strong { color: var(--text-1); font-size: 13.5px; display: block; margin-bottom: 3px; }
  .step-body p { font-size: 13px; color: var(--text-2); margin: 0; }

  .ref-table {
    width: 100%; border-collapse: collapse;
    font-size: 13px; margin-bottom: 16px;
  }
  .ref-table th {
    text-align: left; padding: 0 12px 8px 0;
    font-size: 10.5px; font-weight: 700; color: var(--text-3);
    text-transform: uppercase; letter-spacing: 0.7px;
    border-bottom: 1px solid var(--border);
  }
  .ref-table td {
    padding: 9px 12px 9px 0; vertical-align: top;
    border-bottom: 1px solid var(--border);
    color: var(--text-2); line-height: 1.5;
  }
  .ref-table td:first-child { color: var(--text-1); font-weight: 600; white-space: nowrap; padding-right: 20px; }
  .ref-table tr:last-child td { border-bottom: none; }

  .callout {
    display: flex; gap: 10px; align-items: flex-start;
    background: rgba(0,201,167,0.06); border: 1px solid var(--accent-border);
    border-radius: 9px; padding: 12px 14px; margin-bottom: 14px;
    font-size: 13px; color: var(--text-2); line-height: 1.55;
  }
  .callout mat-icon { color: var(--accent); font-size: 16px; width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; }
  .callout.warn { background: rgba(255,183,77,0.06); border-color: rgba(255,183,77,0.25); }
  .callout.warn mat-icon { color: var(--warn-color); }

  code {
    font-family: 'JetBrains Mono', monospace; font-size: 12px;
    background: var(--bg-raised); border: 1px solid var(--border);
    border-radius: 4px; padding: 1px 6px; color: var(--accent);
  }
  ul { padding-left: 18px; margin: 0 0 12px; }
  li { font-size: 13.5px; color: var(--text-2); line-height: 1.6; margin-bottom: 3px; }
  li strong { color: var(--text-1); }

  hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }

  pre.code-block {
    font-family: 'JetBrains Mono', monospace; font-size: 12px;
    background: var(--bg-raised); border: 1px solid var(--border);
    border-radius: 6px; padding: 10px 14px; margin: 8px 0 14px;
    color: var(--text-2); line-height: 1.6; overflow-x: auto;
    white-space: pre;
  }
  pre.code-block code {
    background: none; border: none; padding: 0; font-size: inherit; color: inherit;
  }
`;
