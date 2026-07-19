import { motion, useScroll, useSpring } from 'motion/react'

// Тонкая золотая полоса прогресса чтения по нижней кромке шапки.
// Привязана к прокрутке страницы (useScroll) и сглажена пружиной (useSpring) —
// движение исходит от самого пользователя, поэтому оно информативно, не декоративно.
export default function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 })
  return <motion.div className="kb-scrollbar" style={{ scaleX }} aria-hidden="true" />
}
