import React, { forwardRef, useMemo, useImperativeHandle } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  SectionList,
  StyleProp,
  ViewStyle,
  SectionListProps,
  LayoutChangeEvent,
  DefaultSectionT, 
} from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useAnimatedRef,
  useSharedValue,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolate,
  useDerivedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';




type AnimatedViewInteractionEvents = React.ComponentProps<typeof Animated.View>['pointerEvents'];


type OpacityTransitionViewProps = {
  customStyle?: StyleProp<Animated.AnimateStyle<StyleProp<ViewStyle>>>;
  visibilityLevel: Animated.SharedValue<number>; 
  visibilityThresholdForInteraction?: number; 
  children?: React.ReactNode;
  dynamicProps?: object; 
} & React.ComponentProps<typeof Animated.View>; 


interface ExpandedHeaderProps {
  children?: React.ReactNode;
}


interface TopNavigationBarProps {
  navBarVisibility?: Animated.SharedValue<number>; 
  leftContent?: React.ReactNode; 
  centerContent?: React.ReactNode; 
  rightContent?: React.ReactNode; 
  ignoreTopPadding?: boolean; 
  BackgroundLayer?: (props: { navBarVisibility?: Animated.SharedValue<number> }) => React.ReactElement | null; 
  scrollOffset?: Animated.SharedValue<number>; 
}


interface ScrollingListProps<ItemT, SectionT = DefaultSectionT> {
  
  NavigationBarComponent: (props: { scrollOffset: Animated.SharedValue<number>; navBarVisibility: Animated.SharedValue<number>; }) => React.ReactElement;
  ExpandedHeaderComponent?: (props: { scrollOffset: Animated.SharedValue<number>; navBarVisibility: Animated.SharedValue<number>; }) => React.ReactElement;
  wrapperStyle?: StyleProp<ViewStyle>; 
  ignoreLeftPadding?: boolean; 
  ignoreRightPadding?: boolean; 
  listContentWrapperStyle?: StyleProp<ViewStyle>; 
  expandedHeaderCollapseThreshold?: number; 
}



/**
 * A view container that animates its opacity and controls pointer events based on visibility.
 */
const OpacityTransitionView = forwardRef<Animated.View, OpacityTransitionViewProps>(
  (
    {
      children,
      customStyle,
      visibilityLevel, 
      dynamicProps = {}, 
      visibilityThresholdForInteraction = 1, 
      ...rest
    },
    ref
  ) => {
    
    const animatedInteractionProps = useAnimatedProps(() => {
      const interactionEvents: AnimatedViewInteractionEvents =
        visibilityLevel.value >= visibilityThresholdForInteraction ? 'auto' : 'none';
      return { pointerEvents: interactionEvents };
    }, [visibilityLevel, visibilityThresholdForInteraction]);

    
    const transitionStyle = useAnimatedStyle(() => ({ opacity: visibilityLevel.value }));

    return (
      <Animated.View
        ref={ref}
        style={[opacityTransitionStyles.base, customStyle, transitionStyle]} 
        animatedProps={{ ...animatedInteractionProps, ...dynamicProps }}
        {...rest}
      >
        {children}
      </Animated.View>
    );
  }
);


const opacityTransitionStyles = StyleSheet.create({
  base: { opacity: 0 }, 
});


const EXPANDED_VERTICAL_PADDING = 6;
const EXPANDED_HORIZONTAL_PADDING = 12;

/**
 * A simple container for the content of the large, expandable header section.
 */
const ExpandedHeader: React.FC<ExpandedHeaderProps> = ({ children }) => (
  <View style={expandedHeaderStyles.wrapper}>{children}</View> 
);


const expandedHeaderStyles = StyleSheet.create({
  wrapper: { 
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: EXPANDED_VERTICAL_PADDING,
    paddingHorizontal: EXPANDED_HORIZONTAL_PADDING,
  },
});


const MIN_CENTER_SECTION_WIDTH_PERCENTAGE = 0.4;

/**
 * The main top navigation bar component, handling layout for left, center, and right content.
 */
const TopNavigationBar: React.FC<TopNavigationBarProps> = ({
  navBarVisibility, 
  leftContent = null, 
  centerContent = null, 
  rightContent = null, 
  ignoreTopPadding = false, 
  BackgroundLayer, 
  
}) => {
  
  const { top: topInset } = useSafeAreaInsets();
  
  const dimensions = useWindowDimensions();
  
  const internalNavBarVisibility = navBarVisibility ?? useSharedValue(1);

  
  const centerSectionExists = !!centerContent;

  
  const { calculatedCenterWidth, minimumSideWidth } = useMemo(() => {
    const centerW = centerSectionExists ? MIN_CENTER_SECTION_WIDTH_PERCENTAGE * dimensions.width : 0;
    const sideW = (dimensions.width - centerW) / 2;
    return { calculatedCenterWidth: centerW, minimumSideWidth: sideW };
  }, [centerSectionExists, dimensions]);

  
  const noSideContent = !leftContent && !rightContent;

  
  const renderSideSection = (
    content: React.ReactNode,
    sectionStyle: StyleProp<ViewStyle>,
    alignment: 'flex-start' | 'flex-end' 
  ) => {
    return (
      <View
        style={[
          sectionStyle, 
          noSideContent && topNavBarStyles.hideFlex, 
          { width: minimumSideWidth, justifyContent: alignment }, 
        ]}
      >
        {content}
      </View>
    );
  };

  return (
    <View>
      
      {BackgroundLayer && BackgroundLayer({ navBarVisibility: internalNavBarVisibility })}

      
      <View style={[topNavBarStyles.navContainer, !ignoreTopPadding && { paddingTop: topInset }]}>
        
        {renderSideSection(leftContent, topNavBarStyles.sideSectionBase, 'flex-start')}

        
        {centerContent &&
          (
            <OpacityTransitionView 
              visibilityLevel={internalNavBarVisibility} 
              customStyle={[topNavBarStyles.centerSection, { minWidth: calculatedCenterWidth }]} 
            >
              {centerContent}
            </OpacityTransitionView>
          )
        }

        
        {renderSideSection(rightContent, topNavBarStyles.sideSectionBase, 'flex-end')}
      </View>
    </View>
  );
};


const topNavBarStyles = StyleSheet.create({
  navContainer: { 
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideSectionBase: { 
    flexDirection: 'row', 
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    overflow: 'hidden',
  },
  centerSection: { 
    flex: 1, 
    flexDirection: 'row',
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hideFlex: { display: 'none' }, 
});




type ScrollingListWithHeaderProps<ItemT, SectionT = DefaultSectionT> =
  Omit<SectionListProps<ItemT, SectionT>, 'onScroll'>
  & ScrollingListProps<ItemT, SectionT>; 


const AnimatedSectionList = Animated.createAnimatedComponent(SectionList) as React.ComponentClass<
  Animated.AnimateProps<SectionListProps<any, any>>, 
  any
>;

/**
 * The core component: A SectionList that integrates collapsible large header
 * and a fixed top navigation bar, animating based on scroll position.
 */
const ScrollingListWithHeaderInternal = <
  ItemT extends any = any, 
  SectionT extends DefaultSectionT = DefaultSectionT 
>(
  {
    NavigationBarComponent, 
    ExpandedHeaderComponent, 
    wrapperStyle, 
    ignoreLeftPadding, 
    ignoreRightPadding, 
    listContentWrapperStyle, 
    expandedHeaderCollapseThreshold = 1, 
    ...rest 
  }: ScrollingListWithHeaderProps<ItemT, SectionT>,
  ref: React.Ref<Animated.ScrollView> 
) => {
  
  const safeAreaInsets = useSafeAreaInsets();
  
  const listRef = useAnimatedRef<SectionList<ItemT, SectionT>>();
  
  useImperativeHandle(ref, () => listRef.current as any);

  
  const scrollOffset = useSharedValue(0);
  
  const expandedHeaderHeight = useSharedValue(0);

  
  
  const navBarVisibility = useDerivedValue(() => {
    if (expandedHeaderHeight.value === 0) return 0; 
    
    return interpolate(
      scrollOffset.value,
      [expandedHeaderHeight.value * (expandedHeaderCollapseThreshold - 0.01), expandedHeaderHeight.value * expandedHeaderCollapseThreshold],
      [0, 1], 
      Extrapolate.CLAMP 
    );
  }, [expandedHeaderHeight, expandedHeaderCollapseThreshold]); 

  
  const scrollEventHandler = useAnimatedScrollHandler({
    onScroll: (event, context) => {
      scrollOffset.value = event.contentOffset.y; 
    },
  });

  return (
    
    <View
      style={[
        scrollingListStyles.outerWrapper, 
        wrapperStyle, 
        !ignoreLeftPadding && { paddingLeft: safeAreaInsets.left }, 
        !ignoreRightPadding && { paddingRight: safeAreaInsets.right }, 
      ]}
    >
      
      <NavigationBarComponent scrollOffset={scrollOffset} navBarVisibility={navBarVisibility} />

      
      <AnimatedSectionList
        ref={listRef} 
        scrollEventThrottle={16} 
        overScrollMode="auto" 
        onScroll={scrollEventHandler} 
        automaticallyAdjustContentInsets={false} 
        contentContainerStyle={listContentWrapperStyle} 
        {...rest} 
        
        ListHeaderComponent={
          <>
            {ExpandedHeaderComponent && ( 
              <View
                
                onLayout={(e: LayoutChangeEvent) => {
                  expandedHeaderHeight.value = e.nativeEvent.layout.height;
                }}
              >
                
                <ExpandedHeaderComponent scrollOffset={scrollOffset} navBarVisibility={navBarVisibility} />
              </View>
            )}
          </>
        }
      />
    </View>
  );
};


const ScrollingListWithHeader = React.forwardRef(ScrollingListWithHeaderInternal) as <
  ItemT = any, 
  SectionT = DefaultSectionT 
>(
  
  props: ScrollingListWithHeaderProps<ItemT, SectionT> & {
    ref?: React.Ref<Animated.ScrollView>; 
  }
) => React.ReactElement; 


const scrollingListStyles = StyleSheet.create({
  outerWrapper: { flex: 1 }, 
  refreshIndicatorContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    width: '100%',
    height: 40,
  },
});


export { OpacityTransitionView, TopNavigationBar, ExpandedHeader, ScrollingListWithHeader };
