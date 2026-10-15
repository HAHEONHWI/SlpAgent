/** 수업 추가 kinds: 바우처 5회 goes into the voucher form, 유료 does not. */
export type Extra = "voucher" | "paid";
export const EXTRA: Record<Extra, string> = { voucher: "추가(바우처 5회)", paid: "추가(유료)" };
