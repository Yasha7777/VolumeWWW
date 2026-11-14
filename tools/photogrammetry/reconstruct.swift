import Foundation
import RealityKit
import Darwin
@main struct Reconstruct {
 static func main() async throws {
  guard CommandLine.arguments.count == 3, PhotogrammetrySession.isSupported else {
   print("Usage: reconstruct INPUT_PHOTOS OUTPUT_DIR (supported Mac required)"); exit(1)
  }
  var failed = false
  let input=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
  let output=URL(fileURLWithPath:CommandLine.arguments[2],isDirectory:true)
  try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true)
  var config=PhotogrammetrySession.Configuration()
  config.sampleOrdering = .sequential
  config.featureSensitivity = .high
  config.isObjectMaskingEnabled = false
  let session=try PhotogrammetrySession(input:input,configuration:config)
  try session.process(requests:[.poses,.pointCloud,.modelFile(url:output.appendingPathComponent("model.usdz"),detail:.reduced)])
  var lastProgress = -1
  for try await event in session.outputs {
   switch event {
   case .requestComplete(_,let result):
    switch result {
    case .poses(let poses):
      var rows:[[String:Any]]=[]
      for (id,p) in poses.posesBySample {
       rows.append(["id":id,"file":poses.urlsBySample[id]?.lastPathComponent ?? "", "translation":[p.translation.x,p.translation.y,p.translation.z],"rotation":[p.rotation.vector.x,p.rotation.vector.y,p.rotation.vector.z,p.rotation.vector.w]])
      }
      try JSONSerialization.data(withJSONObject:rows,options:[.prettyPrinted]).write(to:output.appendingPathComponent("poses.json")); print("POSES",rows.count)
    case .pointCloud(let cloud):
      let rows=cloud.points.map { p -> [Double] in [Double(p.position.x),Double(p.position.y),Double(p.position.z),Double(p.color.x),Double(p.color.y),Double(p.color.z)] }
      try JSONSerialization.data(withJSONObject:rows).write(to:output.appendingPathComponent("points.json"));print("POINTS",rows.count)
    case .modelFile(let url):print("MODEL",url.path)
    default: break
    }
   case .requestProgress(_,let progress):
    let pc=Int(progress*100)/5*5
    if pc != lastProgress { print("PROGRESS",pc);lastProgress=pc }
   case .requestProgressInfo(_,let info):print("STAGE",String(describing:info.processingStage),"remaining",String(describing:info.estimatedRemainingTime))
   case .processingComplete:
    if failed { print("FAILED");exit(1) }
    print("DONE");return
   case .requestError(_,let error):failed=true;print("ERROR",error)
   case .invalidSample(let id,let reason):print("INVALID",id,reason)
   case .skippedSample(let id):print("SKIPPED",id)
   case .inputComplete:print("INPUT_COMPLETE")
   default:break
   }
   fflush(stdout)
  }
 }
}
