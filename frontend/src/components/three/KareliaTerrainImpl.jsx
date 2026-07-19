import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Карельский рельеф: волнистый террейн на Perlin-шуме (техника из 21st Mountain
// Scene), перекрашенный в лес→охру, с камерой, «облетающей» ландшафт по мере
// прокрутки страницы. Тонкий ambient-фон для шапки Истории.
export default function KareliaTerrainImpl() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const w = () => mount.clientWidth || 1
    const h = () => mount.clientHeight || 1

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, w() / h(), 0.1, 100)
    camera.position.set(0, 1.35, 3)
    camera.rotation.x = -0.32

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setSize(w(), h())
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const geometry = new THREE.PlaneGeometry(14, 9, 140, 140)

    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {
        time: { value: 0 },
        uScroll: { value: 0 },
        low:  { value: new THREE.Color('#1e3d12') },   // лес у подножия
        high: { value: new THREE.Color('#c98a24') },   // охра на гребнях
      },
      vertexShader: `
        uniform float time;
        uniform float uScroll;
        varying vec3 vNormal;
        varying float vH;
        vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
        vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
        vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
        vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
        float snoise(vec3 v){
          const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
          vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
          vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
          vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
          vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
          float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
          vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
          vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 hh=1.0-abs(x)-abs(y);
          vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
          vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(hh,vec4(0.0));
          vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
          vec3 p0=vec3(a0.xy,hh.x);vec3 p1=vec3(a0.zw,hh.y);vec3 p2=vec3(a1.xy,hh.z);vec3 p3=vec3(a1.zw,hh.w);
          vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
          p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
          vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
          return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
        }
        void main(){
          vNormal=normal;
          float off = time*0.15 + uScroll*3.0;   // скролл гонит ландшафт «навстречу»
          float d = snoise(vec3(position.x*0.55, position.y*0.55 - off, 0.0)) * 0.62;
          d += snoise(vec3(position.x*1.2, position.y*1.2 - off, 0.0)) * 0.28;
          vH = d;
          vec3 np = position + normal * d;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(np,1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 low; uniform vec3 high;
        varying vec3 vNormal; varying float vH;
        void main(){
          vec3 n = normalize(vNormal);
          float t = clamp(vH*0.9+0.5, 0.0, 1.0);
          vec3 col = mix(low, high, t);
          float fres = pow(1.0 - abs(dot(n, vec3(0.0,0.0,1.0))), 2.0);
          col += high * fres * 0.35;
          gl_FragColor = vec4(col, 0.55);       // приглушённо — это фон
        }
      `,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    scene.add(mesh)

    // прогресс прокрутки всей страницы 0..1 → «облёт»
    let scrollP = 0
    const readScroll = () => {
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1
      scrollP = Math.min(Math.max(window.scrollY / max, 0), 1)
    }
    readScroll()
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => { readScroll(); ticking = false })
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    let raf
    const animate = (t) => {
      material.uniforms.time.value = reduce ? 0 : t * 0.0003
      material.uniforms.uScroll.value += (scrollP - material.uniforms.uScroll.value) * 0.06
      camera.position.x = Math.sin(material.uniforms.uScroll.value * 3.14) * 0.6   // лёгкий снос камеры
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)

    const onResize = () => {
      camera.aspect = w() / h()
      camera.updateProjectionMatrix()
      renderer.setSize(w(), h())
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="kb-terrain3d" aria-hidden="true" />
}
