export const CLASS_PAY = { voucher: "바우처 수업", private: "사비 수업" } as const;
export type ClassPay = keyof typeof CLASS_PAY;
export type Extra = "voucher" | "paid";
export const EXTRA: Record<Extra, string> = { voucher: CLASS_PAY.voucher, paid: CLASS_PAY.private };

export type Pay = "voucher" | "private" | "cognitive" | "pending";
export const PAY: Record<Pay, string> = { voucher: "바우처", private: "사비", cognitive: "인지", pending: "결제 미설정" };
