import { useState, useEffect } from "react"
import { TouchableOpacity, Text, View, StyleSheet } from "react-native"
import Animated, { 
    useSharedValue, 
    useAnimatedStyle, 
    withTiming, 
    withDelay,
    withSequence,
    Easing,
    runOnJS
} from 'react-native-reanimated';
import Like from "~/assets/svg/like.svg"
import LikeFilled from "~/assets/svg/like-filled.svg"


const ConfettiParticle = ({ 
    delay,
    x, 
    y, 
    size, 
    color, 
    duration = 600,
    show
}: { 
    delay: number;
    x: number;
    y: number;
    size: number;
    color: string;
    duration?: number;
    show: boolean;
}) => {
    const opacity = useSharedValue(0);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const scale = useSharedValue(0);

    useEffect(() => {
        if (show) {
            
            opacity.value = withDelay(delay + 300, withTiming(1, { duration: 50 }));
            scale.value = withDelay(delay + 300, withTiming(1, { duration: 100 }));
            
            
            translateX.value = withDelay(delay + 300, withTiming(x, { 
                duration,
                easing: Easing.bezier(0.1, 0.8, 0.2, 1)
            }));
            translateY.value = withDelay(delay + 300, withTiming(y, { 
                duration,
                easing: Easing.bezier(0.1, 0.8, 0.2, 1)
            }));
            
            
            opacity.value = withDelay(delay + 300 + 150, withTiming(0, { 
                duration: duration - 150 
            }));
        } else {
            opacity.value = 0;
            translateX.value = 0;
            translateY.value = 0;
            scale.value = 0;
        }
    }, [show]);

    const animatedStyle = useAnimatedStyle(() => {
        return {
            opacity: opacity.value,
            transform: [
                { translateX: translateX.value },
                { translateY: translateY.value },
                { scale: scale.value },
            ],
        };
    });

    return (
        <Animated.View
            style={[
                {
                    position: 'absolute',
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: color,
                },
                animatedStyle,
            ]}
        />
    );
};

function LikeButton({ iconColor, textColor, likes }: { iconColor: string, textColor: string }) {
    const [isLiked, setIsLiked] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);
    const [currentIconColor, setCurrentIconColor] = useState(iconColor);
    
    
    const unlikedIconScale = useSharedValue(1);
    const redCircleScale = useSharedValue(0);  
    const whiteCircleScale = useSharedValue(0); 
    const likedIconScale = useSharedValue(0);   
    
    
    const unlikedIconStyle = useAnimatedStyle(() => ({
        transform: [{ scale: unlikedIconScale.value }],
        opacity: unlikedIconScale.value,
    }));
    
    const redCircleStyle = useAnimatedStyle(() => ({
        transform: [{ scale: redCircleScale.value }],
        opacity: redCircleScale.value === 0 ? 0 : 1,
    }));
    
    const whiteCircleStyle = useAnimatedStyle(() => ({
        transform: [{ scale: whiteCircleScale.value }],
        opacity: whiteCircleScale.value === 0 ? 0 : 1,
    }));
    
    const likedIconStyle = useAnimatedStyle(() => ({
        transform: [{ scale: likedIconScale.value }],
        opacity: likedIconScale.value,
    }));
    
    const handlePress = () => {
        const willBeLiked = !isLiked;
        setIsLiked(willBeLiked);
        
        if (willBeLiked) {
            
            setCurrentIconColor("#f91880");
            
            
            unlikedIconScale.value = withTiming(0, { 
                duration: 35, 
                easing: Easing.bezier(0.25, 0.1, 0.25, 1)
            });
            
            
            setTimeout(() => {
                
                redCircleScale.value = withTiming(1.05, {
                    duration: 70, 
                    easing: Easing.bezier(0.2, 0.8, 0.2, 1)
                });
                
                
                setTimeout(() => {
                    
                    setShowConfetti(true);
                    
                    
                    whiteCircleScale.value = withTiming(1, {
                        duration: 60, 
                        easing: Easing.bezier(0.1, 0.8, 0.2, 1)
                    });
                    
                    
                    setTimeout(() => {
                        
                        likedIconScale.value = withSequence(
                            withTiming(0.8, { duration: 10 }),  
                            withTiming(1, { duration: 150 }),   
                            withTiming(1.05, { duration: 60 }), 
                            withTiming(1, { duration: 80 })     
                        );
                    }, 20); 
                    
                    
                    setTimeout(() => {
                        redCircleScale.value = withTiming(0, { duration: 50 }); 
                        
                        
                        setTimeout(() => {
                            setShowConfetti(false);
                        }, 140); 
                    }, 105); 
                }, 70); 
            }, 35); 
        } else {
            
            setShowConfetti(false);
            
            setCurrentIconColor(iconColor);
            unlikedIconScale.value = withTiming(1, { duration: 70 }); 
            likedIconScale.value = 0;
            redCircleScale.value = 0;
            whiteCircleScale.value = 0;
        }
    };
    
    
    const confettiParticles = [
        { delay: 0, x: -20, y: -20, size: 4, color: '#91D2FA' },
        { delay: 20, x: 0, y: -25, size: 5, color: '#9FC7FA' },
        { delay: 10, x: 20, y: -20, size: 4, color: '#F48EA7' },
        { delay: 30, x: 25, y: 0, size: 4, color: '#CC8EF5' },
        { delay: 40, x: 20, y: 20, size: 5, color: '#9CD8C3' },
        { delay: 25, x: 0, y: 25, size: 4, color: '#8CE8C3' },
        { delay: 35, x: -20, y: 20, size: 4, color: '#F48EA7' },
        { delay: 15, x: -25, y: 0, size: 5, color: '#CC8EF5' },
        
        { delay: 5, x: -15, y: -22, size: 3, color: '#9FC7FA' },
        { delay: 22, x: 15, y: -22, size: 3, color: '#F48EA7' },
        { delay: 38, x: 22, y: 15, size: 3, color: '#9CD8C3' },
        { delay: 28, x: -22, y: 15, size: 3, color: '#CC8EF5' },
    ];

    return (
        <TouchableOpacity 
            className="flex-row items-center gap-1.5" 
            onPress={handlePress}
            activeOpacity={0.7}
        >
            <View style={styles.iconContainer}>
                
                <Animated.View style={[styles.circleContainer, redCircleStyle]}>
                    <View style={[styles.circle, { backgroundColor: '#f91880' }]} />
                </Animated.View>
                
                
                <Animated.View style={[styles.circleContainer, whiteCircleStyle]}>
                    <View style={[styles.circle, { backgroundColor: 'white' }]} />
                </Animated.View>
                
                
                {confettiParticles.map((particle, index) => (
                    <ConfettiParticle
                        key={index}
                        delay={particle.delay}
                        x={particle.x}
                        y={particle.y}
                        size={particle.size}
                        color={particle.color}
                        show={showConfetti}
                    />
                ))}
                
                
                <Animated.View style={[styles.iconAbsolute, unlikedIconStyle]}>
                    <Like width={18} height={18} fill={currentIconColor} />
                </Animated.View>
                
                
                <Animated.View style={[styles.iconAbsolute, likedIconStyle]}>
                    <LikeFilled width={18} height={18} fill={"#f91880"} />
                </Animated.View>
            </View>
            
            <Text 
                className={textColor} 
                style={{ 
                    color: isLiked ? "#f91880" : iconColor 
                }}
            >
               {likes}
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    iconContainer: {
        position: 'relative',
        width: 35,
        height: 35,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: -8
    },
    iconAbsolute: {
        position: 'absolute',
        justifyContent: 'center',
        alignItems: 'center',
    },
    circleContainer: {
        position: 'absolute',
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    circle: {
        width: '100%',
        height: '100%',
        borderRadius: 12,
    }
});

export default LikeButton