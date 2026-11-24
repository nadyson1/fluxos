package app.fluxos.editor;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "JsonExport")
public class JsonExportPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename");
        String content = call.getString("content");
        if (filename == null || filename.trim().isEmpty() || content == null) {
            call.reject("Nome ou conteúdo do arquivo ausente.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        call.getData().put("content", content);
        startActivityForResult(call, intent, "onCreateDocumentResult");
    }

    @ActivityCallback
    private void onCreateDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent resultIntent = result.getData();
        Uri uri = result.getResultCode() == Activity.RESULT_OK && resultIntent != null ? resultIntent.getData() : null;
        if (uri == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }

        String content = call.getString("content");
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (output == null) throw new IOException("O local escolhido não permitiu gravar o arquivo.");
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
            call.resolve(new JSObject().put("cancelled", false).put("uri", uri.toString()));
        } catch (IOException exception) {
            call.reject("Não foi possível salvar o arquivo JSON.", exception);
        }
    }
}
