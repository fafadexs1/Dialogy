"use client";

import React, { useEffect, useRef } from "react";

interface ShootingStar {
    id: number;
    x: number;
    y: number;
    angle: number;
    scale: number;
    speed: number;
    distance: number;
}

interface ShootingStarsProps {
    minDelay?: number;
    maxDelay?: number;
    minSpeed?: number;
    maxSpeed?: number;
    starColor?: string;
    trailColor?: string;
    starWidth?: number;
    starHeight?: number;
    className?: string;
}

export const ShootingStars = ({
    minDelay = 1200,
    maxDelay = 4200,
    minSpeed = 10,
    maxSpeed = 30,
    starColor = "#9E00FF",
    trailColor = "#2EB9DF",
    starWidth = 10,
    starHeight = 1,
    className,
}: ShootingStarsProps) => {
    const starRef = useRef<ShootingStar | null>(null);
    const rectRef = useRef<SVGRectElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const requestRef = useRef<number | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const createStar = () => {
            const { innerWidth } = window;
            const x = Math.random() * innerWidth;
            const y = 0;
            const angle = 45;
            const scale = 1;
            const speed = Math.random() * (maxSpeed - minSpeed) + minSpeed;
            const distance = 0;

            starRef.current = {
                id: Date.now(),
                x,
                y,
                angle,
                scale,
                speed,
                distance,
            };

            if (rectRef.current) {
                // Initial position
                rectRef.current.setAttribute("x", x.toString());
                rectRef.current.setAttribute("y", y.toString());
                rectRef.current.setAttribute("width", (starWidth * scale).toString());
                rectRef.current.setAttribute("transform", `rotate(${angle}, ${x + (starWidth * scale) / 2}, ${y + starHeight / 2})`);
                rectRef.current.style.opacity = "1";
            }

            // Start animation loop for this star
            requestRef.current = requestAnimationFrame(moveStar);
        };

        const moveStar = () => {
            if (starRef.current && rectRef.current) {
                const prevStar = starRef.current;

                const newX = prevStar.x + prevStar.speed * Math.cos((prevStar.angle * Math.PI) / 180);
                const newY = prevStar.y + prevStar.speed * Math.sin((prevStar.angle * Math.PI) / 180);
                const newDistance = prevStar.distance + prevStar.speed;
                const newScale = 1 + newDistance / 100;

                // Check bounds
                if (
                    newX < -20 ||
                    newX > window.innerWidth + 20 ||
                    newY > window.innerHeight + 20
                ) {
                    // Star finished
                    rectRef.current.style.opacity = "0";
                    starRef.current = null;

                    // Schedule next star
                    const randomDelay = Math.random() * (maxDelay - minDelay) + minDelay;
                    timeoutRef.current = setTimeout(createStar, randomDelay);
                    return; // Stop this loop
                }

                // Update star data
                starRef.current = {
                    ...prevStar,
                    x: newX,
                    y: newY,
                    distance: newDistance,
                    scale: newScale,
                };

                // Direct DOM update
                rectRef.current.setAttribute("x", newX.toString());
                rectRef.current.setAttribute("y", newY.toString());
                rectRef.current.setAttribute("width", (starWidth * newScale).toString());
                // Update rotation center based on new position
                rectRef.current.setAttribute("transform", `rotate(${prevStar.angle}, ${newX + (starWidth * newScale) / 2}, ${newY + starHeight / 2})`);

                requestRef.current = requestAnimationFrame(moveStar);
            }
        };

        // Start the first star loop
        createStar();

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [minDelay, maxDelay, minSpeed, maxSpeed, starWidth, starHeight]);

    return (
        <svg
            ref={svgRef}
            className={`pointer-events-none fixed inset-0 z-0 h-full w-full ${className}`}
        >
            <rect
                ref={rectRef}
                height={starHeight}
                fill="url(#gradient)"
                style={{ opacity: 0 }} // Initially hidden
            />
            <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{ stopColor: trailColor, stopOpacity: 0 }} />
                    <stop
                        offset="100%"
                        style={{ stopColor: starColor, stopOpacity: 1 }}
                    />
                </linearGradient>
            </defs>
        </svg>
    );
};
