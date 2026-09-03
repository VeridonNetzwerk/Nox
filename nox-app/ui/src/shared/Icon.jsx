import React from "react";

const baseProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function IconGear({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <circle cx="128" cy="128" r="34" />
      <path d="M114.6,36.7a8,8,0,0,1,7.4-5.3h12a8,8,0,0,1,7.4,5.3l6.9,18.5a56.1,56.1,0,0,1,14.7,8.5l19.5-4.4a8,8,0,0,1,8.8,4.3l6,10.4a8,8,0,0,1-1.4,9.6L176.9,97.4a56,56,0,0,1,0,17.2l13.9,12.5a8,8,0,0,1,1.4,9.6l-6,10.4a8,8,0,0,1-8.8,4.3l-19.5-4.4a56.1,56.1,0,0,1-14.7,8.5l-6.9,18.5a8,8,0,0,1-7.4,5.3h-12a8,8,0,0,1-7.4-5.3l-6.9-18.5a56.1,56.1,0,0,1-14.7-8.5l-19.5,4.4a8,8,0,0,1-8.8-4.3l-6-10.4a8,8,0,0,1,1.4-9.6L79.1,114.6a56,56,0,0,1,0-17.2L65.2,84.9a8,8,0,0,1-1.4-9.6l6-10.4a8,8,0,0,1,8.8-4.3l19.5,4.4a56.1,56.1,0,0,1,14.7-8.5Z" transform="translate(0 0)" />
    </svg>
  );
}

export function IconRobot({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <rect x="32" y="56" width="192" height="136" rx="24" />
      <line x1="128" y1="16" x2="128" y2="56" />
      <circle cx="128" cy="16" r="8" fill="currentColor" stroke="none" />
      <circle cx="84" cy="108" r="12" />
      <circle cx="172" cy="108" r="12" />
      <path d="M100,148h56" />
      <line x1="32" y1="96" x2="16" y2="96" />
      <line x1="32" y1="136" x2="16" y2="136" />
      <line x1="224" y1="96" x2="240" y2="96" />
      <line x1="224" y1="136" x2="240" y2="136" />
    </svg>
  );
}

export function IconMicrophone({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <rect x="88" y="24" width="80" height="120" rx="40" />
      <path d="M64,120a64,64,0,0,0,128,0" />
      <line x1="128" y1="184" x2="128" y2="216" />
      <line x1="96" y1="216" x2="160" y2="216" />
    </svg>
  );
}

export function IconEye({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <path d="M24,128c5.6-7.4,52-72,104-72s98.4,64.6,104,72c-5.6,7.4-52,72-104,72S29.6,135.4,24,128Z" />
      <circle cx="128" cy="128" r="32" />
    </svg>
  );
}

export function IconFolder({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <path d="M32,72V200a8,8,0,0,0,8,8H216a8,8,0,0,0,8-8V88a8,8,0,0,0-8-8H128L104,56H40A8,8,0,0,0,32,64Z" />
    </svg>
  );
}

export function IconInfo({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <circle cx="128" cy="128" r="96" />
      <line x1="128" y1="120" x2="128" y2="176" />
      <circle cx="128" cy="84" r="4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconWarning({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <path d="M128,24a104,104,0,0,0-91.8,152.5l-12.5,35.6a8,8,0,0,0,9.8,9.8l35.6-12.5A104,104,0,1,0,128,24Z" />
      <line x1="128" y1="88" x2="128" y2="144" />
      <circle cx="128" cy="172" r="4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCheckCircle({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M88,128l32,32,48-56" />
    </svg>
  );
}

export function IconX({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <line x1="56" y1="56" x2="200" y2="200" />
      <line x1="200" y1="56" x2="56" y2="200" />
    </svg>
  );
}

export function IconCheck({ size = 20, weight = 2, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <path d="M40,140l56,56L216,76" />
    </svg>
  );
}

export function IconArrowLeft({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <line x1="216" y1="128" x2="40" y2="128" />
      <polyline points="112,56 40,128 112,200" />
    </svg>
  );
}

export function IconArrowDown({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <line x1="128" y1="40" x2="128" y2="216" />
      <polyline points="56,144 128,216 200,144" />
    </svg>
  );
}

export function IconSearch({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <circle cx="112" cy="112" r="72" />
      <line x1="168" y1="168" x2="216" y2="216" />
    </svg>
  );
}

export function IconPlus({ size = 20, weight = 2, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <line x1="128" y1="40" x2="128" y2="216" />
      <line x1="40" y1="128" x2="216" y2="128" />
    </svg>
  );
}

export function IconArrowRight({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <line x1="40" y1="128" x2="216" y2="128" />
      <polyline points="144,56 216,128 144,200" />
    </svg>
  );
}

export function IconSpeaker({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <path d="M80,96H32a8,8,0,0,0-8,8v48a8,8,0,0,0,8,8H80l64,48V48Z" />
      <path d="M152,96a40,40,0,0,1,0,64" />
      <path d="M176,72a72,72,0,0,1,0,112" />
    </svg>
  );
}

export function IconSpinner({ size = 20, weight = 1.5, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" {...baseProps} strokeWidth={weight} {...props}>
      <path d="M128,32a96,96,0,0,1,96,96" />
    </svg>
  );
}
