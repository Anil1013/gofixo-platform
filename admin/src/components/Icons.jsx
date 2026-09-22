export function BikeIcon(props) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="15" cy="46" r="10" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="49" cy="46" r="10" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M15 46L24 26H35M35 26L44 46M35 26L30 18M15 46H24L35 26M44 46L38 33"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M26 18H34" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="24" cy="26" r="2" fill="currentColor" />
    </svg>
  );
}

export function CarIcon(props) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M9 40V33.5L14 23a4 4 0 013.6-2.2h28.8A4 4 0 0150 23l5 10.5V40"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <rect x="6" y="40" width="52" height="9" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
      <path d="M14 27H50" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="18" cy="49" r="5" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="46" cy="49" r="5" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

export function HomeToolIcon(props) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M12 30L32 14L52 30" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 27V48A2 2 0 0020 50H44A2 2 0 0046 48V27" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path
        d="M28 50V40A2 2 0 0130 38H34A2 2 0 0136 40V50"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M40 22.5C41.5 21 43.8 21 45.3 22.5C46.8 24 46.8 26.3 45.3 27.8L40 33L34.5 27.5L40 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
