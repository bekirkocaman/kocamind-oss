import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number | string;
  strokeWidth?: number | string;
  title?: string;
}

export interface IconBaseProps extends IconProps {
  children?: ReactNode;
}

export type IconComponent = (props: IconProps) => React.JSX.Element;

export function IconBase({
  size = 16,
  className,
  strokeWidth = 1.5,
  title,
  children,
  ...rest
}: IconBaseProps) {
  const hasTitle = Boolean(title);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={hasTitle ? 'img' : undefined}
      aria-hidden={hasTitle ? undefined : true}
      {...rest}
    >
      {hasTitle ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
