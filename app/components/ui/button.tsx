// Adapted from founded-labs/react-native-reusables (MIT); LuckRead-specific color and sizing tokens.
import { cva, type VariantProps } from 'class-variance-authority';
import { Platform, Pressable } from 'react-native';

import { cn } from '~/lib/utils';
import { TextClassContext } from '~/components/ui/text';

const buttonVariants = cva(
  cn(
    'group shrink-0 flex-row items-center justify-center gap-2 rounded-full shadow-none',
    Platform.select({
      web: 'whitespace-nowrap outline-none transition-all focus-visible:ring-2 focus-visible:ring-[#1769aa]/40 disabled:pointer-events-none',
    }),
  ),
  {
    variants: {
      variant: {
        default: cn(
          'bg-[#1769aa] active:bg-[#145987] shadow-sm shadow-black/5',
          Platform.select({ web: 'hover:bg-[#145987]' }),
        ),
        destructive: cn(
          'bg-red-600 active:bg-red-700 dark:bg-red-700',
          Platform.select({ web: 'hover:bg-red-700' }),
        ),
        outline: cn(
          'border border-neutral-300 bg-transparent active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-900',
          Platform.select({ web: 'hover:bg-neutral-100 dark:hover:bg-neutral-900' }),
        ),
        secondary: cn(
          'bg-neutral-100 active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700',
          Platform.select({ web: 'hover:bg-neutral-200 dark:hover:bg-neutral-700' }),
        ),
        ghost: cn(
          'bg-transparent active:bg-neutral-100 dark:active:bg-neutral-800',
          Platform.select({ web: 'hover:bg-neutral-100 dark:hover:bg-neutral-800' }),
        ),
        link: '',
      },
      size: {
        default: 'min-h-[40px] px-[16px] py-[10px]',
        sm: 'min-h-[34px] gap-[6px] px-[12px] py-[7px]',
        lg: 'min-h-[44px] px-[24px] py-[12px]',
        icon: 'h-[40px] w-[40px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const buttonTextVariants = cva('text-sm font-semibold', {
  variants: {
    variant: {
      default: 'text-white',
      destructive: 'text-white',
      outline: 'text-neutral-900 dark:text-neutral-100',
      secondary: 'text-neutral-900 dark:text-neutral-100',
      ghost: 'text-neutral-900 dark:text-neutral-100',
      link: 'text-[#1769aa] dark:text-[#63b3f4]',
    },
    size: {
      default: '',
      sm: '',
      lg: '',
      icon: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

type ButtonProps = React.ComponentProps<typeof Pressable> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        accessibilityRole="button"
        className={cn(props.disabled && 'opacity-50', buttonVariants({ variant, size }), className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
