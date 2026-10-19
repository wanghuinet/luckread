import {Image} from "expo-image";
import { cssInterop } from "nativewind";

export const StyledExpoImage = cssInterop(Image, {
    className: 'style',
});

