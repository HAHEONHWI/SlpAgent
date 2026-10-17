/** 수업 추가 kinds: 바우처 5회 goes into the voucher form, 유료 does not. */
export type Extra = "voucher" | "paid";
export const EXTRA: Record<Extra, string> = { voucher: "추가(바우처 5회)", paid: "추가(유료)" };

/** 결제 구분 of a held class: 바우처 up to the month's 26만원, then 사비; 인지 = 인지치료 at the 사비 price, counted apart. */
export type Pay = "voucher" | "private" | "cognitive";
export const PAY: Record<Pay, string> = { voucher: "바우처", private: "사비", cognitive: "인지" };
