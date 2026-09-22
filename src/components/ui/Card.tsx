import React from 'react';
import { clsx } from 'clsx';
interface CardProps extends React.HTMLAttributes<HTMLDivElement> { elevated?: boolean; }
export const Card: React.FC<CardProps> = ({ className, elevated, children, ...props }) => <div {...props} className={clsx('card', elevated && 'card-elevated', className)}>{children}</div>;
