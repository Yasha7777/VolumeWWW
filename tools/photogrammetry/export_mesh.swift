import Foundation
import ModelIO
import simd
let asset=MDLAsset(url:URL(fileURLWithPath:CommandLine.arguments[1]))
var vertices:[[Float]]=[];var faces:[[Int]]=[]
for item in asset.childObjects(of:MDLMesh.self) {
 guard let mesh=item as? MDLMesh, let vd=mesh.vertexAttributeData(forAttributeNamed:MDLVertexAttributePosition,as:.float3) else { continue }
 let transform=MDLTransform.globalTransform(with:mesh,atTime:0)
 let offset=vertices.count
 for i in 0..<mesh.vertexCount {
  let ptr=vd.dataStart.advanced(by:i*vd.stride).assumingMemoryBound(to:Float.self)
  let p=transform*SIMD4<Float>(ptr[0],ptr[1],ptr[2],1)
  vertices.append([p.x,p.y,p.z])
 }
 for case let sub as MDLSubmesh in mesh.submeshes ?? [] {
  guard sub.geometryType == .triangles else { print("SKIP_NONTRIANGLES",sub.geometryType.rawValue);continue }
  let map=sub.indexBuffer.map();let ptr=map.bytes
  func index(_ i:Int)->Int {
   switch sub.indexType {
    case .uInt8:return Int(ptr.assumingMemoryBound(to:UInt8.self)[i])
    case .uInt16:return Int(ptr.assumingMemoryBound(to:UInt16.self)[i])
    default:return Int(ptr.assumingMemoryBound(to:UInt32.self)[i])
   }
  }
  for i in stride(from:0,to:sub.indexCount-2,by:3) {faces.append([index(i)+offset,index(i+1)+offset,index(i+2)+offset])}
 }
}
let data=try JSONSerialization.data(withJSONObject:["vertices":vertices,"faces":faces])
try data.write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
print("EXPORTED",vertices.count,faces.count)
