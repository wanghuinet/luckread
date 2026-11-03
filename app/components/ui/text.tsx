import { Slot } from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Platform, Text as RNText, type Role } from 'react-native';

import { cn } from '~/lib/utils';

const textVariants = cva(
  cn(
    'text-neutral-900 dark:text-neutral-100 text-base',
    Platform.select({ web: 'select-text' }),
  ),
  {
    variants: {
      variant: {
        default: '',
        h1: 'text-center text-4xl font-extrabold tracking-tight',
        h2: 'border-neutral-200 dark:border-neutral-800 border-b pb-2 text-3xl font-semibold tracking-tight',
        h3: 'text-2xl font-semibold tracking-tight',
        h4: 'text-xl font-semibold tracking-tight',
        p: 'mt-3 leading-7',
        blockquote: 'mt-4 border-l-2 pl-3 italic',
        code: 'bg-neutral-100 dark:bg-neutral-800 relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold',
        lead: 'text-neutral-600 dark:text-neutral-300 text-xl',
        large: 'text-lg font-semibold',
        small: 'text-sm font-medium leading-none',
        muted: 'text-neutral-500 dark:text-neutral-400 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type TextVariantProps = VariantProps<typeof textVariants>;
type TextVariant = NonNullable<TextVariantProps['variant']>;

const ROLE: Partial<Record<TextVariant, Role>> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  blockquote: Platform.select({ web: 'blockquote' as Role }),
  code: Platform.select({ web: 'code' as Role }),
};

const ARIA_LEVEL: Partial<Record<TextVariant, string>> = {
  h1: '1',
  h2: '2',
  h3: '3',
  h4: '4',
};

export const TextClassContext = React.createContext<string | undefined>(undefined);

function Text({
  className,
  asChild = false,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof RNText> &
  React.RefAttributes<typeof RNText> &
  TextVariantProps & {
    asChild?: boolean;
  }) {
  const textClass = React.useContext(TextClassContext);
  const Component = asChild ? Slot : RNText;

  return (
    <Component
      className={cn(textVariants({ variant }), textClass, className)}
      role={variant ? ROLE[variant] : undefined}
      aria-level={variant ? ARIA_LEVEL[variant] : undefined}
      {...props}
    />
  );
}

export { Text };
