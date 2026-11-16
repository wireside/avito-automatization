using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace AvitoSigner {
 public sealed class BackgroundHost {
  public const string Name = "AvitoWarehouseSigner";
  private readonly ManualResetEvent stopping = new ManualResetEvent(false);
  private readonly object gate = new object();
  private readonly string directory = AppDomain.CurrentDomain.BaseDirectory;
  public static void Main() {
   BackgroundHost host=new BackgroundHost();
   if(!File.Exists(Path.Combine(host.directory,"config.json"))) { host.Log("CONFIG_MISSING"); Environment.Exit(1); }
   host.Supervise();
  }
  public static ProcessStartInfo AgentStartInfo(string dir) {
   return new ProcessStartInfo {
    FileName=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
    Arguments="-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File \""+Path.Combine(dir,"agent.ps1")+"\" -ConfigPath \""+Path.Combine(dir,"config.json")+"\" -BackgroundMode",
    WorkingDirectory=dir, UseShellExecute=false, CreateNoWindow=true,
    RedirectStandardOutput=true, RedirectStandardError=true
   };
  }
  private void Log(string code) {
   lock(gate) {
    try {
     string path=Path.Combine(directory,"background.log");
     if(File.Exists(path) && new FileInfo(path).Length>1048576) {
      if(File.Exists(path+".1")) File.Delete(path+".1"); File.Move(path,path+".1");
     }
     File.AppendAllText(path,DateTime.UtcNow.ToString("o")+" "+code+Environment.NewLine);
    } catch { /* Never emit arbitrary exception messages or credentials. */ }
   }
  }
  private void SafeAgentLog(object sender, DataReceivedEventArgs args) {
   if(args.Data!=null && System.Text.RegularExpressions.Regex.IsMatch(args.Data,
    @"^(?:[0-9T:\-]+ )?SIGNER_UNAVAILABLE STAGE=[A-Z_]{1,48} HRESULT=0x[0-9A-F]{8} LINE=[0-9]+$")) Log(args.Data);
  }
  private static void Kill(Process process) {
   if(process==null) return;
   try { if(!process.HasExited) process.Kill(); process.WaitForExit(5000); } catch { }
  }
  private void Supervise() {
   Log("HOST_STARTED");
   while(!stopping.WaitOne(0)) {
    Process process=null; IntPtr job=IntPtr.Zero;
    try {
     job=Native.CreateKillJob();
     process=new Process(); process.StartInfo=AgentStartInfo(directory);
     process.OutputDataReceived+=SafeAgentLog;
     // stderr is drained but never persisted: PowerShell can include source lines/secrets.
     process.ErrorDataReceived+=delegate { };
     if(!process.Start()) throw new InvalidOperationException("PROCESS_START_FAILED");
     if(!Native.AssignProcessToJobObject(job,process.Handle)) throw new Win32Exception();
     process.BeginOutputReadLine(); process.BeginErrorReadLine();
     DateTime launched=DateTime.UtcNow;
     Log("AGENT_STARTED");
     while(!stopping.WaitOne(5000) && !process.HasExited) {
      string health=Path.Combine(directory,"agent.alive");
      DateTime seen=File.Exists(health) ? File.GetLastWriteTimeUtc(health) : launched;
      if(seen<launched) seen=launched;
      if(DateTime.UtcNow-seen>TimeSpan.FromMinutes(3)) { Log("AGENT_STALLED"); break; }
     }
     if(!stopping.WaitOne(0)) {
      if(process.HasExited) Log("AGENT_EXIT_CODE="+process.ExitCode.ToString(System.Globalization.CultureInfo.InvariantCulture));
      Log("AGENT_RESTARTING");
     }
    } catch { Log("AGENT_START_FAILED"); }
    finally {
     Kill(process);
     if(job!=IntPtr.Zero) Native.CloseHandle(job);
     if(process!=null) process.Dispose();
    }
    stopping.WaitOne(10000);
   }
   Log("HOST_STOPPED");
  }
 }
 internal static class Native {
  [StructLayout(LayoutKind.Sequential)] internal struct BasicLimits { public long ProcessTime,JobTime; public uint Flags; public UIntPtr MinWorkingSet,MaxWorkingSet; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint Priority,Scheduling; }
  [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory; }
  [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] private static extern bool SetInformationJobObject(IntPtr job,int info,ref ExtendedLimits limits,int size);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
  internal static IntPtr CreateKillJob() {
   IntPtr job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception();
   ExtendedLimits limits=new ExtendedLimits(); limits.Basic.Flags=0x2000;
   if(!SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(limits))) { CloseHandle(job); throw new Win32Exception(); }
   return job;
  }
 }
}
