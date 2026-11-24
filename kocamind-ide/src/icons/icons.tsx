import { IconBase, type IconProps } from './IconBase.tsx';

const FILE_BODY_D =
  'M4 1.5h5.5L13.5 5.5v7.5a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 13V3A1.5 1.5 0 0 1 4 1.5Z';
const FILE_FOLD_D = 'M9.5 1.5V4.5a1 1 0 0 0 1 1h3';

export function WinMinimize({ strokeWidth = 1, ...props }: IconProps) {
  return (
    <IconBase strokeWidth={strokeWidth} {...props}>
      <path d="M3.5 8.5h9" />
    </IconBase>
  );
}

export function WinMaximize({ strokeWidth = 1, ...props }: IconProps) {
  return (
    <IconBase strokeWidth={strokeWidth} {...props}>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </IconBase>
  );
}

export function WinRestore({ strokeWidth = 1, ...props }: IconProps) {
  return (
    <IconBase strokeWidth={strokeWidth} {...props}>
      <rect x="3.5" y="5.5" width="7" height="7" rx="1.25" />
      <path d="M5.5 3.5H11a1.5 1.5 0 0 1 1.5 1.5v5.5" />
    </IconBase>
  );
}

export function WinClose({ strokeWidth = 1, ...props }: IconProps) {
  return (
    <IconBase strokeWidth={strokeWidth} {...props}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </IconBase>
  );
}

export function FileTs(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d={FILE_BODY_D} />
      <path d={FILE_FOLD_D} />
      <path d="M5.25 8h5.5M8 8v4.25" />
    </IconBase>
  );
}

export function FileJs(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d={FILE_BODY_D} />
      <path d={FILE_FOLD_D} />
      <path d="M6.5 7.5H5v5h1.5M9.5 7.5H11v5H9.5" />
    </IconBase>
  );
}

export function FileJson(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d={FILE_BODY_D} />
      <path d={FILE_FOLD_D} />
      <path d="M6.5 7.25C5.25 7.25 5.25 9.25 4.5 10c.75.75.75 2.75 2 2.75M9.5 7.25c1.25 0 1.25 2 2 2.75-.75.75-.75 2.75-2 2.75" />
    </IconBase>
  );
}

export function FileCss(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d={FILE_BODY_D} />
      <path d={FILE_FOLD_D} />
      <path d="M5 8.75h6M4.75 11.25h6M7 7.25l-.75 5.5M9.75 7.25l-.75 5.5" />
    </IconBase>
  );
}

export function FileHtml(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d={FILE_BODY_D} />
      <path d={FILE_FOLD_D} />
      <path d="M6.75 7.75L4.75 10l2 2.25M9.25 7.75L11.25 10l-2 2.25" />
    </IconBase>
  );
}

export function FileMd(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d={FILE_BODY_D} />
      <path d={FILE_FOLD_D} />
      <path d="M8 7v5M5.75 10L8 12.25 10.25 10" />
    </IconBase>
  );
}

export function FileImage(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d={FILE_BODY_D} />
      <path d={FILE_FOLD_D} />
      <path d="M5 12l2.25-2.5L9 11.25l2-1.75M6 8.25h.01" />
    </IconBase>
  );
}

export function FileGeneric(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d={FILE_BODY_D} />
      <path d={FILE_FOLD_D} />
    </IconBase>
  );
}
