import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { writeXlsx, type SheetSpec } from "./xlsx";

/** Build an .xlsx on the phone and open the Android share sheet (save to Drive, send by KakaoTalk or mail, ...). */
export async function shareXlsx(name: string, sheets: SheetSpec[]) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(writeXlsx(sheets));
  if (!(await Sharing.isAvailableAsync())) throw new Error("이 기기에서는 파일 공유를 사용할 수 없어요.");
  await Sharing.shareAsync(file.uri, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", dialogTitle: name, UTI: "org.openxmlformats.spreadsheetml.sheet" });
}
