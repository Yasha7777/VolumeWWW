import{r as w,S,n as b,W as E,v as M,w as C,k as z,D as P,x as _,j}from"./vendor-three-B8dUSmoH.js";function R(){const v=w.useRef(null);return w.useEffect(()=>{var h;const t=v.current;if(!t)return;const g=(h=window.matchMedia)==null?void 0:h.call(window,"(prefers-reduced-motion: reduce)").matches,n=()=>t.clientWidth||1,i=()=>t.clientHeight||1,l=new S,o=new b(60,n()/i(),.1,100);o.position.set(0,1.35,3),o.rotation.x=-.32;const e=new E({antialias:!0,alpha:!0,powerPreference:"high-performance"});e.setSize(n(),i()),e.setPixelRatio(Math.min(window.devicePixelRatio,2)),t.appendChild(e.domElement);const m=new M(14,9,140,140),r=new C({side:P,transparent:!0,uniforms:{time:{value:0},uScroll:{value:0},low:{value:new z("#1e3d12")},high:{value:new z("#c98a24")}},vertexShader:`
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
      `,fragmentShader:`
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
      `}),x=new _(m,r);x.rotation.x=-Math.PI/2,l.add(x);let d=0;const p=()=>{const s=document.documentElement.scrollHeight-window.innerHeight||1;d=Math.min(Math.max(window.scrollY/s,0),1)};p();let c=!1;const u=()=>{c||(c=!0,requestAnimationFrame(()=>{p(),c=!1}))};window.addEventListener("scroll",u,{passive:!0});let a;const y=s=>{r.uniforms.time.value=g?0:s*3e-4,r.uniforms.uScroll.value+=(d-r.uniforms.uScroll.value)*.06,o.position.x=Math.sin(r.uniforms.uScroll.value*3.14)*.6,o.lookAt(0,0,0),e.render(l,o),a=requestAnimationFrame(y)};a=requestAnimationFrame(y);const f=()=>{o.aspect=n()/i(),o.updateProjectionMatrix(),e.setSize(n(),i())};return window.addEventListener("resize",f),()=>{cancelAnimationFrame(a),window.removeEventListener("scroll",u),window.removeEventListener("resize",f),m.dispose(),r.dispose(),e.dispose(),e.domElement.parentNode===t&&t.removeChild(e.domElement)}},[]),j.jsx("div",{ref:v,className:"kb-terrain3d","aria-hidden":"true"})}export{R as default};
