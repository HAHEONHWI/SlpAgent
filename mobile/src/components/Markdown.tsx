import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { C } from "./ui";

// Small Markdown renderer for AI answers: headings, lists, quotes, code blocks, tables and **bold** / *italic* / `code`.
// Links show their text only and images their alt text, like the web chat (no external content is loaded).

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*)\*|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\([^)]*\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2] ?? m[3]) out.push(<Text key={k} style={{ fontWeight: "700" }}>{inline(m[2] ?? m[3], i)}</Text>);
    else if (m[4]) out.push(<Text key={k} style={{ fontFamily: "monospace", backgroundColor: C.paper, fontSize: 13 }}>{m[4]}</Text>);
    else if (m[5]) out.push(<Text key={k} style={{ fontStyle: "italic" }}>{m[5]}</Text>);
    else if (m[6] !== undefined) out.push(<Text key={k} style={{ color: C.sub, fontSize: 12 }}>{m[6] ? `[이미지: ${m[6]}]` : "[외부 이미지 표시 안 함]"}</Text>);
    else if (m[7]) out.push(m[7]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const P = ({ children, style }: { children: ReactNode; style?: object }) => <Text selectable style={[{ fontSize: 15, lineHeight: 24, color: C.ink }, style]}>{children}</Text>;
const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = blocks.length;
    if (/^```/.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      blocks.push(<ScrollView key={k} horizontal style={{ backgroundColor: C.inkDark, borderRadius: 10 }}><Text selectable style={{ color: "#fff", fontFamily: "monospace", fontSize: 12, padding: 10 }}>{body.join("\n")}</Text></ScrollView>);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      blocks.push(<P key={k} style={{ fontWeight: "700", fontSize: level === 1 ? 20 : level === 2 ? 18 : 16, color: C.inkDark, marginTop: 6 }}>{inline(line.replace(/^#+\s/, ""), k)}</P>);
      i++;
    } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:-]+\|/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      blocks.push(
        <ScrollView key={k} horizontal>
          <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 8 }}>
            {[head, ...rows].map((r, ri) => (
              <View key={ri} style={{ flexDirection: "row", borderTopWidth: ri ? 1 : 0, borderColor: C.line, backgroundColor: ri ? "transparent" : C.paper }}>
                {r.map((c, ci) => <View key={ci} style={{ width: 140, padding: 6 }}><P style={{ fontSize: 13, lineHeight: 19, fontWeight: ri ? "400" : "700" }}>{inline(c, ci)}</P></View>)}
              </View>))}
          </View>
        </ScrollView>);
    } else if (/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      const items: ReactNode[] = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s/.test(lines[i]); i++) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s(.*)$/)!;
        items.push(
          <View key={i} style={{ flexDirection: "row", gap: 6, paddingLeft: Math.min(m[1].length, 6) * 6 }}>
            <P>{/\d/.test(m[2]) ? m[2] : "•"}</P><View style={{ flex: 1 }}><P>{inline(m[3], i)}</P></View>
          </View>);
      }
      blocks.push(<View key={k} style={{ gap: 2 }}>{items}</View>);
    } else if (/^>\s?/.test(line)) {
      const body: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ""));
      blocks.push(<View key={k} style={{ borderLeftWidth: 3, borderColor: C.border, paddingLeft: 10 }}><P style={{ color: C.text2 }}>{inline(body.join("\n"), k)}</P></View>);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<View key={k} style={{ height: 1, backgroundColor: C.line, marginVertical: 4 }} />); i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const body: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|\s*\|.*\|\s*$)/.test(lines[i]); i++) body.push(lines[i]);
      if (!body.length) { body.push(lines[i]); i++; }
      blocks.push(<P key={k}>{inline(body.join("\n"), k)}</P>);
    }
  }
  return <View style={{ gap: 8 }}>{blocks}</View>;
}
