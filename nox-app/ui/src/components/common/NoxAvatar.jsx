import React from "react";

export default function NoxAvatar({ size = 32, className = "", glowing = false, style = {} }) {
  const uid = React.useId();
  return (
    <div
      className={`nox-avatar ${glowing ? "nox-avatar-glowing" : ""} ${className}`}
      style={{ "--nox-avatar-size": `${size}px`, ...style }}
      aria-label="Nox"
      role="img"
    >
      <svg viewBox="0 0 100 100" className="nox-blob-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={`nox-grad-${uid}`} x1="10%" y1="5%" x2="90%" y2="95%">
            <stop offset="0%" stopColor="#e930f0" />
            <stop offset="32%" stopColor="#8b2df5" />
            <stop offset="62%" stopColor="#2b6cf0" />
            <stop offset="100%" stopColor="#1fe0e0" />
          </linearGradient>
        </defs>

        <g fill={`url(#nox-grad-${uid})`}>
          <path
            className="nox-blob-path"
            d="M22,30
               C21,17 33,11 42,19
               C49,26 53,37 59,48
               C61,53 64,54 64,47
               C64,39 65,31 71,27
               C80,21 89,28 87,39
               C85,49 84,57 84,67
               C84,79 75,87 67,82
               C59,77 55,67 47,55
               C44,50 41,50 40,57
               C39,65 39,73 35,79
               C28,86 17,81 17,70
               C17,59 21,49 22,39
               Z"
          />
          <ellipse className="nox-droplet nox-droplet-a" cx="13" cy="87" rx="4.6" ry="4" />
          <ellipse className="nox-droplet nox-droplet-b" cx="91" cy="20" rx="5" ry="4.3" />
        </g>
      </svg>
    </div>
  );
}
