// Reads the game's own code: finds methods in Jibbers' IL2CPP binary (GameAssembly.dll + global-metadata.dat) by
// type/method name and disassembles them, with the calls, string literals, types, methods and fields the code refers
// to written beside the instructions, and the type's fields with their offsets (--fields). Uses LibCpp2IL and Iced
// (MIT, from NuGet: LibCpp2IL's development builds are on its author's feed, in nuget.config).
//   dotnet run -c Release -- <type substring, or =exact full name> [method substring] [--fields]
//   dotnet run -c Release -- x --xref <text>       (the methods calling or referring to it)
//   dotnet run -c Release -- x --strings <file>    (the hidden strings, below)
// e.g. `-- Mujoco.MjHeightFieldShape PrepareHeightMap` is how the flat-ground fall-through was found (project.rs
// never_flat). The game is obfuscated: Unity's, MuJoCo's and Map-Tools' names are real, most of the game's aren't.
using System.Reflection;
using Iced.Intel;
using LibCpp2IL;
using LibCpp2IL.Metadata;

const string G = @"C:\Program Files (x86)\Steam\steamapps\common\Jibbers Playtest";
var typeFilter = args.Length > 0 ? args[0] : "MjHeightFieldShape";
var methodFilter = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : "";
var showFields = args.Contains("--fields");
LibCpp2IlMain.Settings.AllowManualMetadataAndCodeRegInput = false;
// the library's own progress lines go nowhere; ours to the real output
var stdout = Console.Out;
Console.SetOut(TextWriter.Null);
var unity = LibCpp2IlMain.DetermineUnityVersion(Path.Combine(G, "Jibbers.exe"), Path.Combine(G, "Jibbers_Data"));
var ok = LibCpp2IlMain.LoadFromFile(Path.Combine(G, "GameAssembly.dll"), Path.Combine(G, @"Jibbers_Data\il2cpp_data\Metadata\global-metadata.dat"), unity);
Console.SetOut(stdout);
if (!ok) { Console.WriteLine("load failed"); return; }
var bin = LibCpp2IlMain.Binary;
var raw = bin.GetRawBinaryContent();
var starts = LibCpp2IlMain.MethodsByPtr.Keys.Where(k => k != 0).OrderBy(k => k).ToArray();

var hidden = new Dictionary<ulong, string>();

string Name(ulong va)
{
    if (hidden.TryGetValue(va, out var str)) return $"\"{str}\"";
    if (LibCpp2IlMain.MethodsByPtr.TryGetValue(va, out var ms) && ms.Count > 0)
        return string.Join(" | ", ms.Take(2).Select(m => $"{m.DeclaringType?.FullName}.{m.Name}"));
    if (bin.TryGetExportedFunctionName(va, out var ex)) return ex;
    return null;
}

string Global(ulong addr)
{
    try
    {
        var lit = LibCpp2IlMain.GetLiteralByAddress(addr);
        if (lit != null) return $"\"{lit}\"";
    }
    catch { }
    try
    {
        var g = LibCpp2IlMain.GetAnyGlobalByAddress(addr);
        if (g != null) return g.ToString();
    }
    catch { }
    return null;
}

// The game's hidden strings (the obfuscator's <PrivateImplementationDetails>…a: one byte array, each byte xor'd with its
// index and 0xAA, read back by its getters as UTF-8 at an offset and a length), by getter address: written beside calls
// to them, and with --strings <file> written out as "getter<TAB>string" lines.
{
    var md = LibCpp2IlMain.TheMetadata;
    var t = md.typeDefs.First(x => (x.FullName ?? "").StartsWith("<PrivateImplementationDetails>{") && x.FullName.EndsWith("}.a") && (x.FieldInfos?.Length ?? 0) == 3);
    int Num(object o) => Convert.ToInt32(o.GetType().GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance).Select(f => f.GetValue(o)).First(v => v is int or uint or long or ulong));
    var dv = md.GetFieldDefaultValue(t.FieldInfos[0].Field);
    var at = Num(md.metadataHeader.fieldAndParameterDefaultValueData) + Num(dv.GetType().GetFields().First(f => f.Name.ToLower().Contains("data")).GetValue(dv)!);
    var file = File.ReadAllBytes(Path.Combine(G, @"Jibbers_Data\il2cpp_data\Metadata\global-metadata.dat"));
    var cctor = t.Methods!.First(m => m.Name == ".cctor");
    // (the array's length: the cctor's second array allocation)
    var n = 0;
    {
        var off = bin.MapVirtualAddressToRaw(cctor.MethodPointer, false);
        var dec = Iced.Intel.Decoder.Create(64, new ByteArrayCodeReader(raw[(int)off..(int)(off + 512)]));
        var edx = new List<int>();
        for (var k = 0; k < 60; k++)
        {
            var ins = dec.Decode();
            if (ins.Code == Code.Mov_r32_imm32 && ins.Op0Register == Register.EDX) edx.Add((int)ins.Immediate32);
        }
        n = edx[1];
    }
    var bytes = new byte[n];
    for (var i = 0; i < n; i++) bytes[i] = (byte)(file[at + i] ^ (i & 0xFF) ^ 0xAA);
    foreach (var m in t.Methods)
    {
        if (m.MethodPointer == 0 || m.parameterCount != 0) continue;
        var off = bin.MapVirtualAddressToRaw(m.MethodPointer, false);
        var dec = Iced.Intel.Decoder.Create(64, new ByteArrayCodeReader(raw[(int)off..(int)(off + 256)]));
        int? o = null, l = null;
        // (mov reg, imm or lea reg, [zeroed reg + imm], up to the call)
        for (var k = 0; k < 80; k++)
        {
            var ins = dec.Decode();
            int? v = ins.Code == Code.Mov_r32_imm32 ? (int)ins.Immediate32 : ins.Code == Code.Lea_r32_m ? (int)ins.MemoryDisplacement32 : null;
            if (v != null && ins.Op0Register == Register.EDX) o = v;
            if (v != null && ins.Op0Register == Register.R8D) l = v;
            if (ins.FlowControl == FlowControl.Call && o != null && l != null) break;
        }
        if (o is int oo && l is int ll && oo + ll <= n) hidden[m.MethodPointer] = System.Text.Encoding.UTF8.GetString(bytes, oo, ll);
    }
    if (args.Contains("--strings"))
    {
        File.WriteAllLines(args[Array.IndexOf(args, "--strings") + 1], t.Methods.Where(m => hidden.ContainsKey(m.MethodPointer)).Select(m => $"{m.Name}	{hidden[m.MethodPointer]}"));
        Console.WriteLine($"{hidden.Count} strings");
        return;
    }
}

// --xref <text>: the methods whose code calls something, or refers to a string or global, whose note contains the text
if (args.Contains("--xref"))
{
    var want = args[Array.IndexOf(args, "--xref") + 1];
    foreach (var va in starts)
    {
        var next = starts.FirstOrDefault(s => s > va);
        var len = (int)Math.Min(next > va ? next - va : 4096, 16384);
        var off = bin.MapVirtualAddressToRaw(va, false);
        if (off <= 0 || off + len > raw.Length) continue;
        var dec = Iced.Intel.Decoder.Create(64, new ByteArrayCodeReader(raw[(int)off..(int)(off + len)]));
        dec.IP = va;
        while (dec.IP < va + (ulong)len)
        {
            var ins = dec.Decode();
            string note = null;
            if (ins.FlowControl is FlowControl.Call or FlowControl.UnconditionalBranch && ins.Op0Kind is OpKind.NearBranch64) note = Name(ins.NearBranch64);
            else if (ins.IsIPRelativeMemoryOperand) note = Global(ins.IPRelativeMemoryAddress);
            if (note != null && note.Contains(want)) { Console.WriteLine($"0x{va:x}  {Name(va)}   ({note})"); break; }
        }
    }
    return;
}

foreach (var t in LibCpp2IlMain.TheMetadata.typeDefs)
{
    var full = t.FullName ?? "";
    if (!full.Contains(typeFilter)) continue;
    Console.WriteLine($"######## {full} (methods {t.Methods?.Length ?? 0}){(t.BaseType != null ? " : " + t.BaseType : "")}");
    if (showFields && t.FieldInfos != null)
        foreach (var fi in t.FieldInfos)
        {
            var parts = fi.GetType().GetFields(BindingFlags.Public | BindingFlags.Instance).Select(f => $"{f.Name}={f.GetValue(fi)}")
                .Concat(fi.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(pr => { try { return $"{pr.Name}={pr.GetValue(fi)}"; } catch { return null; } }).Where(x => x != null));
            Console.WriteLine("   field " + string.Join("  ", parts));
        }
    foreach (var m in t.Methods ?? Array.Empty<Il2CppMethodDefinition>())
    {
        if (methodFilter != "" && !m.Name.Contains(methodFilter)) continue;
        var va = m.MethodPointer;
        Console.WriteLine($"=== {m.HumanReadableSignature}  VA 0x{va:x}");
        if (va == 0 || methodFilter == "") continue;
        var next = starts.FirstOrDefault(s => s > va);
        var len = (int)Math.Min(next > va ? next - va : 4096, 16384);
        var off = bin.MapVirtualAddressToRaw(va, false);
        var code = new byte[len];
        Array.Copy(raw, off, code, 0, Math.Min(len, raw.Length - off));
        var dec = Iced.Intel.Decoder.Create(64, new ByteArrayCodeReader(code));
        dec.IP = va;
        var fmt = new IntelFormatter();
        fmt.Options.FirstOperandCharIndex = 8;
        var sb = new StringOutput();
        while (dec.IP < va + (ulong)len)
        {
            var ins = dec.Decode();
            fmt.Format(in ins, sb);
            var text = sb.ToStringAndReset();
            string note = null;
            if (ins.FlowControl is FlowControl.Call or FlowControl.UnconditionalBranch && ins.Op0Kind is OpKind.NearBranch64)
                note = Name(ins.NearBranch64);
            if (note == null && ins.IsIPRelativeMemoryOperand)
                note = Global(ins.IPRelativeMemoryAddress) ?? Name(ins.IPRelativeMemoryAddress);
            Console.WriteLine($"  {ins.IP:x}  {text,-60}{(note != null ? " ; " + note : "")}");
            if (ins.Code == Code.Int3 && ins.IP > va + 16) break;
        }
    }
}
