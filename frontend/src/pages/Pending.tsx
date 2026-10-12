import { Notice, PageTitle } from "../components/ui";

export default function Pending({ title, note }: { title: string; note: string }) {
  return <><PageTitle title={title} /><Notice>아직 구현되지 않은 기능입니다. {note}</Notice></>;
}
