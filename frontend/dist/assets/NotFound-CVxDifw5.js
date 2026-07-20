import{j as e}from"./vendor-three-DxliSVRj.js";import{a as s}from"./index-DZ8A4L_a.js";import"./vendor-pdf-BqHPsZAs.js";import"./vendor-supabase-BazgpBWu.js";const o="/assets/cheremsha-B-PvWHo_.png";function c(){const i=s();return e.jsxs("div",{style:t.page,children:[e.jsx("style",{children:`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@700&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap');

        @keyframes breathe {
          0%,100% { transform: translate(-50%,-50%) scale(1); }
          50%      { transform: translate(-50%,-52%) scale(1.025); }
        }
        @keyframes flicker {
          0%,91%,93%,100% { opacity: 1; }
          92% { opacity: 0.3; }
        }
        @keyframes eyes {
          0%,85%,100% { opacity: 0; }
          87%,97%     { opacity: 1; }
        }
        @keyframes tick {
          from { transform: translateX(100vw); }
          to   { transform: translateX(-200%); }
        }
        .cheremsha-creature {
          position: absolute;
          left: 50%; top: 48%;
          transform: translate(-50%, -50%);
          width: 68%;
          animation: breathe 4s ease-in-out infinite;
          filter: sepia(0.4) contrast(1.05);
        }
        .eye-glow {
          position: absolute;
          top: 27%; left: 43%;
          width: 14%; height: 6%;
          background: radial-gradient(ellipse, rgba(255,180,60,0.55), transparent 70%);
          border-radius: 50%;
          animation: eyes 5s ease-in-out infinite;
        }
        .error-num {
          font-family: 'Oswald', sans-serif;
          font-size: 80px;
          font-weight: 700;
          color: #c8a84a;
          line-height: 1;
          animation: flicker 7s infinite;
          text-shadow: 0 0 30px rgba(200,168,74,0.2);
        }
        .ticker {
          display: inline-block;
          font-family: 'Oswald', sans-serif;
          font-size: 9px;
          letter-spacing: 2.5px;
          color: rgba(200,168,74,0.22);
          text-transform: uppercase;
          animation: tick 28s linear infinite;
          white-space: nowrap;
        }
        .btn-home {
          display: block;
          width: 100%;
          background: transparent;
          border: 1px solid rgba(200,168,74,0.3);
          color: #c8a84a;
          font-family: 'Oswald', sans-serif;
          font-size: 13px;
          letter-spacing: 3px;
          text-transform: uppercase;
          padding: 12px;
          cursor: pointer;
          border-radius: 2px;
          transition: all 0.2s;
          margin-bottom: 1rem;
        }
        .btn-home:hover {
          background: rgba(200,168,74,0.07);
          border-color: rgba(200,168,74,0.5);
        }
        .fact-item::before { content: '—  '; color: rgba(200,168,74,0.3); }
      `}),e.jsx("div",{style:t.scan}),e.jsx("div",{style:t.vign}),e.jsx("div",{style:t.holes,children:[...Array(6)].map((a,r)=>e.jsx("div",{style:t.hole},r))}),e.jsxs("div",{style:t.wrap,children:[e.jsxs("div",{style:t.photoBox,children:[e.jsx("img",{src:o,alt:"Черемша",style:{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top",filter:"sepia(0.2) contrast(1.05)"}}),e.jsx("div",{className:"eye-glow"})]}),e.jsxs("div",{style:t.textBlock,children:[e.jsxs("div",{style:t.errorRow,children:[e.jsx("div",{className:"error-num",children:"404"}),e.jsxs("div",{style:t.errorLabel,children:["Страница утеряна",e.jsx("br",{}),"при невыясненных обстоятельствах"]})]}),e.jsxs("div",{style:t.narrator,children:["В советском союзе страниц не было.",e.jsx("br",{}),"Была только ",e.jsx("strong",{style:{color:"#d4b96a"},children:"Черемша"}),".",e.jsx("br",{}),"Тихо. Не спеша. Без лишней суеты.",e.jsx("br",{}),"Страница, которую вы ищете,"," ",e.jsx("strong",{style:{color:"#d4b96a"},children:"замурована в шлакоблок"})," ","и вывезена в Припять."]}),e.jsxs("div",{style:t.factsBox,children:[e.jsx("div",{style:t.factsHead,children:"Справка · НИИ «Институт перспективного утепления» · 1962"}),["Черемшу замуровывали в стены хрущёвок живьём — голова снаружи, мурлыкала по вечерам","Уши работали как антенна радио «Маяк». Тело — как приёмник","С 1965 по 1967 г. была генеральным секретарём ЦК КПСС. Указы подписывала пушистой лапой","В 1991-м каждую конфисковали, спрятали в шлакоблок, увезли под 4-й энергоблок ЧАЭС","Выжившие до сих пор мурчат на антресолях заброшенных хрущёвок"].map((a,r)=>e.jsx("div",{className:"fact-item",style:t.fact,children:a},r))]}),e.jsxs("div",{style:t.rhyme,children:["тихо, не спеша, не дыша —",e.jsx("br",{}),"ни шиша, ни коврижа —",e.jsx("br",{}),"без монтажа, без витража —",e.jsx("br",{}),"эта страница была. Черемша."]}),e.jsx("button",{className:"btn-home",onClick:()=>i("/"),children:"← Вернуться. Тихо. Не спеша."}),e.jsx("div",{style:t.tickerWrap,children:e.jsx("span",{className:"ticker",children:"В СССР СТРАНИЦ НЕ БЫЛО · ЧЕРЕМША ЗАМЕНЯЛА ВСЁ · СТЕКЛОВАТА · ГУТАЛИН · НИИ ПЕРСПЕКТИВНОГО УТЕПЛЕНИЯ · ШЛАКОБЛОК · ПРИПЯТЬ · ТИХО НЕ СПЕША · ЧЕРЕМША · БЕЗ СУЕТЫ · БЕЗ МОНТАЖА · БЕЗ ЭПАТАЖА · ЧЕРЕМША ·"})}),e.jsx("div",{style:t.stamp,children:e.jsx("span",{style:t.stampText,children:"Сов. секретно · фонд №404 · хранить вечно"})})]})]})]})}const t={page:{background:"#1a1612",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"2rem 1rem",position:"relative",overflow:"hidden",fontFamily:"'PT Serif', serif"},scan:{position:"fixed",inset:0,background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.09) 2px,rgba(0,0,0,0.09) 4px)",pointerEvents:"none",zIndex:50},vign:{position:"fixed",inset:0,background:"radial-gradient(ellipse at 50% 40%,transparent 35%,rgba(0,0,0,0.75) 100%)",pointerEvents:"none",zIndex:49},holes:{position:"absolute",left:8,top:0,bottom:0,display:"flex",flexDirection:"column",justifyContent:"space-around",padding:"12px 0",zIndex:10},hole:{width:12,height:12,borderRadius:"50%",background:"#0e0a06",border:"1.5px solid #2a2010"},wrap:{position:"relative",zIndex:5,width:"100%",maxWidth:520},photoBox:{width:"100%",paddingTop:"75%",background:"linear-gradient(170deg,#2e2416 0%,#1a120a 60%,#0e0a06 100%)",borderRadius:3,position:"relative",overflow:"hidden",marginBottom:"1.5rem"},textBlock:{padding:"0 0.25rem"},errorRow:{display:"flex",alignItems:"baseline",gap:14,marginBottom:"0.6rem"},errorLabel:{fontFamily:"'Oswald', sans-serif",fontSize:13,letterSpacing:3,color:"rgba(200,168,74,0.45)",textTransform:"uppercase",paddingBottom:4,borderBottom:"1px solid rgba(200,168,74,0.15)",lineHeight:1.6},narrator:{fontSize:15,lineHeight:1.8,color:"#b5a480",fontStyle:"italic",marginBottom:"1.1rem",borderLeft:"2px solid rgba(200,168,74,0.2)",paddingLeft:12},factsBox:{background:"#110f0a",border:"0.5px solid rgba(200,168,74,0.12)",borderRadius:3,padding:"0.9rem 1rem",marginBottom:"1.1rem"},factsHead:{fontFamily:"'Oswald', sans-serif",fontSize:9,letterSpacing:3,color:"rgba(200,168,74,0.3)",textTransform:"uppercase",marginBottom:"0.6rem"},fact:{fontSize:13,lineHeight:1.7,color:"rgba(180,160,110,0.65)",padding:"3px 0",borderBottom:"0.5px solid rgba(255,255,255,0.04)"},rhyme:{fontSize:13,color:"rgba(180,160,110,0.45)",fontStyle:"italic",lineHeight:2,marginBottom:"1.2rem",textAlign:"center",letterSpacing:"0.5px"},tickerWrap:{overflow:"hidden",whiteSpace:"nowrap",padding:"6px 0",borderTop:"0.5px solid rgba(200,168,74,0.1)"},stamp:{marginTop:"0.75rem",textAlign:"center"},stampText:{display:"inline-block",border:"2px solid rgba(180,40,40,0.35)",color:"rgba(200,60,60,0.4)",fontFamily:"'Oswald', sans-serif",fontSize:9,letterSpacing:3,padding:"3px 12px",transform:"rotate(-1.5deg)",textTransform:"uppercase"}};export{c as default};
