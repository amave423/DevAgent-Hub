import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { connectTerminal } from "../api/terminal";

import "xterm/css/xterm.css";

// Suppress unused warnings — these are used at runtime
void FitAddon;
void WebLinksAddon;

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "JetBrains Mono, Consolas, 'Courier New', monospace",
      theme: {
        background: "#080a0c",
        foreground: "#a8e8c9",
        cursor: "#a8e8c9",
      },
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const socket = connectTerminal();
    socket.onOutput = (data: string) => term.write(data);
    socket.onClose = () => term.write("\r\n\x1b[31m[disconnected]\x1b[0m\r\n");
    socket.onError = () => term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");

    term.onData((data) => socket.send(data));

    const handleResize = () => {
      fitAddon.fit();
      const { cols, rows } = term;
      socket.resize(cols, rows);
    };

    window.addEventListener("resize", handleResize);
    xtermRef.current = term;
    fitRef.current = fitAddon;

    // Initial resize after mount
    setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      socket.close();
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} className="xterm-container" />;
}
