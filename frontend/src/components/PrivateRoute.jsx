import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function PrivateRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display:'flex', justifyContent:'center', alignItems:'center', minHeight:'100vh' }}>
        {/* цвета из токенов: прежние rgba(30,61,18,.2) + var(--green) в тёмной
            теме давали тёмно-зелёное кольцо на тёмном фоне — спиннер был не виден */}
        <div className="spinner" style={{ borderColor:'var(--border)', borderTopColor:'var(--gold)', width:32, height:32, borderWidth:3 }} />
      </div>
    )
  }

  return user ? children : <Navigate to="/login" replace />
}
