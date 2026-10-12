type BrandLogoProps = { className?: string };

export default function BrandLogo({ className = "" }: BrandLogoProps) {
  return (
    <div className={`overflow-hidden ${className}`} style={{ aspectRatio: "2 / 1" }}>
      <img
        src="/brand/slp-ai-logo.png"
        alt="SLP AI"
        className="block h-full w-full object-cover"
        style={{ objectPosition: "50% 44%" }}
      />
    </div>
  );
}
